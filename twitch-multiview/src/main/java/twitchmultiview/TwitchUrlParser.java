package twitchmultiview;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 貼り付けられた文字列から Twitch の配信を読み取る。
 *
 * <p>読めるもの:
 * <ul>
 *   <li>{@code https://www.twitch.tv/チャンネル名}（{@code m.} や {@code popout/…/chat} も可）</li>
 *   <li>{@code チャンネル名} や {@code @チャンネル名} だけ</li>
 *   <li>{@code https://www.twitch.tv/videos/番号?t=1h2m3s}（アーカイブ）</li>
 *   <li>{@code https://clips.twitch.tv/ID} と {@code https://www.twitch.tv/チャンネル名/clip/ID}（クリップ）</li>
 *   <li>{@code https://player.twitch.tv/?channel=…} / {@code ?video=…}（埋め込みプレイヤーの URL）</li>
 * </ul>
 */
public final class TwitchUrlParser {

    /** 解析結果。{@code invalid} には読めなかった断片をそのまま入れる。 */
    public record Result(List<StreamEntry> entries, List<String> invalid) {}

    private static final Pattern SEPARATORS = Pattern.compile("[\\s\\u3000,、，]+");
    private static final Pattern CHANNEL = Pattern.compile("[A-Za-z0-9_]{1,25}");
    private static final Pattern VIDEO_ID = Pattern.compile("v?(\\d{1,20})");
    private static final Pattern CLIP_SLUG = Pattern.compile("[A-Za-z0-9_-]{1,100}");
    private static final Pattern TIME = Pattern.compile(
            "(?:(\\d{1,5})h)?(?:(\\d{1,5})m)?(?:(\\d{1,7})s)?|(\\d{1,7})");
    private static final Pattern HAS_SCHEME = Pattern.compile("^[A-Za-z][A-Za-z0-9+.-]*://.*");
    private static final String TRIM_LEADING = "<([{「『【（\"'";
    private static final String TRIM_TRAILING = ">)]}」』】）\"'.,;:!?。、！？";

    /** twitch.tv 直下にある、チャンネル名ではないページ */
    private static final Set<String> RESERVED_PATHS = Set.of(
            "directory", "search", "settings", "subscriptions", "inventory", "wallet", "drops",
            "friends", "messages", "following", "downloads", "jobs", "p", "prime", "store", "turbo",
            "login", "signup", "logout", "payments", "broadcast", "dashboard", "u", "bits", "redeem",
            "team", "products", "creatorcamp", "event", "collections");

    private TwitchUrlParser() {}

    /**
     * 空白・改行・カンマで区切られた文字列をまとめて読む。
     *
     * <p>文章ごと貼られたとき（{@code twitch.tv} を含むとき）は {@code twitch.tv} を含む断片だけを拾う。
     * ふつうの単語をチャンネル名と取り違えないため。
     */
    public static Result parse(String text) {
        List<StreamEntry> entries = new ArrayList<>();
        List<String> invalid = new ArrayList<>();
        if (text == null) {
            return new Result(entries, invalid);
        }
        boolean urlsOnly = text.toLowerCase(Locale.ROOT).contains("twitch.tv");
        for (String raw : SEPARATORS.split(text.strip())) {
            String token = trim(raw);
            if (token.isEmpty()) {
                continue;
            }
            if (urlsOnly && !token.toLowerCase(Locale.ROOT).contains("twitch.tv")) {
                continue;
            }
            parseOne(token).ifPresentOrElse(entries::add, () -> invalid.add(token));
        }
        return new Result(List.copyOf(entries), List.copyOf(invalid));
    }

    /** URL かチャンネル名 1 つを読む。 */
    public static Optional<StreamEntry> parseOne(String input) {
        if (input == null) {
            return Optional.empty();
        }
        String token = trim(input);
        if (token.startsWith("@")) {
            token = token.substring(1);
        }
        if (CHANNEL.matcher(token).matches()) {
            return Optional.of(StreamEntry.live(token));
        }

        URI uri;
        try {
            uri = new URI(HAS_SCHEME.matcher(token).matches() ? token : "https://" + token);
        } catch (URISyntaxException e) {
            return Optional.empty();
        }
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (host == null || !("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))) {
            return Optional.empty();
        }
        host = host.toLowerCase(Locale.ROOT);
        if (!host.equals("twitch.tv") && !host.endsWith(".twitch.tv")) {
            return Optional.empty();
        }

        List<String> path = segments(uri.getPath());
        Map<String, String> query = query(uri.getRawQuery());

        if (host.equals("clips.twitch.tv")) {
            if (path.isEmpty()) {
                return Optional.empty();
            }
            return clip(path.get(0).equals("embed") ? query.get("clip") : path.get(0));
        }
        if (host.equals("player.twitch.tv")) {
            if (query.containsKey("video")) {
                return vod(query.get("video"), query.getOrDefault("time", query.get("t")));
            }
            return channel(query.get("channel"));
        }
        return fromPath(path, query);
    }

    private static Optional<StreamEntry> fromPath(List<String> path, Map<String, String> query) {
        if (path.isEmpty()) {
            return Optional.empty();
        }
        String first = path.get(0).toLowerCase(Locale.ROOT);
        if (first.equals("videos")) {
            return path.size() >= 2 ? vod(path.get(1), query.get("t")) : Optional.empty();
        }
        // popout/<ch>/chat・embed/<ch>/chat・moderator/<ch> はその後ろがチャンネル名
        if (first.equals("popout") || first.equals("embed") || first.equals("moderator")) {
            return fromPath(path.subList(1, path.size()), query);
        }
        if (RESERVED_PATHS.contains(first) || !CHANNEL.matcher(first).matches()) {
            return Optional.empty();
        }
        if (path.size() >= 3) {
            String kind = path.get(1).toLowerCase(Locale.ROOT);
            if (kind.equals("clip")) {
                return clip(path.get(2));
            }
            if (kind.equals("v") || kind.equals("video")) {
                return vod(path.get(2), query.get("t"));
            }
        }
        return Optional.of(StreamEntry.live(first));
    }

    private static Optional<StreamEntry> channel(String name) {
        return name != null && CHANNEL.matcher(name).matches()
                ? Optional.of(StreamEntry.live(name))
                : Optional.empty();
    }

    private static Optional<StreamEntry> vod(String id, String time) {
        if (id == null) {
            return Optional.empty();
        }
        Matcher m = VIDEO_ID.matcher(id);
        return m.matches() ? Optional.of(StreamEntry.vod(m.group(1), normalizeTime(time))) : Optional.empty();
    }

    private static Optional<StreamEntry> clip(String slug) {
        return slug != null && CLIP_SLUG.matcher(slug).matches()
                ? Optional.of(StreamEntry.clip(slug))
                : Optional.empty();
    }

    /** {@code 1h2m3s}・{@code 90s}・{@code 90}（秒）を {@code 1h2m3s} の形にそろえる。読めなければ {@code null}。 */
    static String normalizeTime(String raw) {
        if (raw == null) {
            return null;
        }
        Matcher m = TIME.matcher(raw.strip().toLowerCase(Locale.ROOT));
        if (!m.matches()) {
            return null;
        }
        long seconds = m.group(4) != null
                ? Long.parseLong(m.group(4))
                : number(m.group(1)) * 3600 + number(m.group(2)) * 60 + number(m.group(3));
        if (seconds <= 0) {
            return null;
        }
        long h = seconds / 3600;
        long min = seconds % 3600 / 60;
        long s = seconds % 60;
        if (h > 0) {
            return h + "h" + min + "m" + s + "s";
        }
        return min > 0 ? min + "m" + s + "s" : s + "s";
    }

    private static long number(String digits) {
        return digits == null ? 0 : Long.parseLong(digits);
    }

    /** 前後のカッコ・引用符・句読点を取る（「…」で囲まれた URL や文末の「。」対策）。 */
    private static String trim(String s) {
        int start = 0;
        int end = s.length();
        while (start < end && TRIM_LEADING.indexOf(s.charAt(start)) >= 0) {
            start++;
        }
        while (end > start && TRIM_TRAILING.indexOf(s.charAt(end - 1)) >= 0) {
            end--;
        }
        return s.substring(start, end).strip();
    }

    private static List<String> segments(String path) {
        if (path == null) {
            return List.of();
        }
        return Arrays.stream(path.split("/")).filter(seg -> !seg.isEmpty()).toList();
    }

    private static Map<String, String> query(String raw) {
        Map<String, String> map = new HashMap<>();
        if (raw == null || raw.isEmpty()) {
            return map;
        }
        for (String pair : raw.split("&")) {
            int eq = pair.indexOf('=');
            String key = decode(eq < 0 ? pair : pair.substring(0, eq));
            String value = eq < 0 ? "" : decode(pair.substring(eq + 1));
            map.putIfAbsent(key, value);
        }
        return map;
    }

    private static String decode(String s) {
        try {
            return URLDecoder.decode(s, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return s;
        }
    }
}
