package twitchmultiview;

import java.util.Locale;
import java.util.Objects;

/**
 * 複窓に並べる 1 枠ぶんの配信。
 *
 * @param type 種類（ライブ・アーカイブ・クリップ）
 * @param id   ライブならチャンネル名（小文字）、アーカイブなら動画番号、クリップならクリップ ID
 * @param time アーカイブの再生開始位置（例 {@code 1h2m3s}）。指定なし・ライブ・クリップでは {@code null}
 */
public record StreamEntry(Type type, String id, String time) {

    public enum Type {
        LIVE("live", "ライブ"),
        VOD("vod", "アーカイブ"),
        CLIP("clip", "クリップ");

        private final String code;
        private final String displayName;

        Type(String code, String displayName) {
            this.code = code;
            this.displayName = displayName;
        }

        /** ブラウザ側に渡す種類名 */
        public String code() {
            return code;
        }

        public String displayName() {
            return displayName;
        }
    }

    public StreamEntry {
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(id, "id");
        if (type != Type.VOD) {
            time = null;
        }
    }

    public static StreamEntry live(String channel) {
        return new StreamEntry(Type.LIVE, channel.toLowerCase(Locale.ROOT), null);
    }

    public static StreamEntry vod(String videoId, String time) {
        return new StreamEntry(Type.VOD, videoId, time);
    }

    /** クリップ ID は大文字小文字を区別するのでそのまま持つ。 */
    public static StreamEntry clip(String slug) {
        return new StreamEntry(Type.CLIP, slug, null);
    }

    /** 同じ配信かどうかの判定に使うキー。アーカイブの開始位置は見ない。 */
    public String key() {
        return type.code() + ":" + id;
    }

    /** 枠の上に出す短い名前。 */
    public String label() {
        return switch (type) {
            case LIVE -> id;
            case VOD -> "アーカイブ " + id + (time == null ? "" : " (" + time + "〜)");
            case CLIP -> "クリップ " + id;
        };
    }

    /** 一覧やメッセージ用の「[種類] 名前」。 */
    public String description() {
        return switch (type) {
            case LIVE -> "[ライブ] " + id;
            case VOD -> "[アーカイブ] " + id + (time == null ? "" : " (" + time + "〜)");
            case CLIP -> "[クリップ] " + id;
        };
    }

    /** Twitch 上のページの URL。保存ファイルにもこの形で書く。 */
    public String url() {
        return switch (type) {
            case LIVE -> "https://www.twitch.tv/" + id;
            case VOD -> "https://www.twitch.tv/videos/" + id + (time == null ? "" : "?t=" + time);
            case CLIP -> "https://clips.twitch.tv/" + id;
        };
    }
}
