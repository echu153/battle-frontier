package twitchmultiview;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 複窓に並べる配信の一覧。Swing の画面とブラウザの両方から触るのでスレッドセーフにしてある。
 *
 * <p>変わるたびに {@code version} が増える。ブラウザはこれを見て描き直す。
 * {@code storage} を渡すと一覧をファイルに保存し、次回起動時に読み戻す。
 */
public final class MultiViewState {

    public record Snapshot(long version, List<StreamEntry> entries) {}

    public record AddResult(List<StreamEntry> added, List<StreamEntry> duplicates, List<String> invalid) {

        /** 画面に出す一言。 */
        public String message() {
            List<String> parts = new ArrayList<>();
            if (!added.isEmpty()) {
                parts.add(added.size() + " 件追加しました");
            }
            if (!duplicates.isEmpty()) {
                parts.add("追加済み: " + summarize(duplicates.stream().map(StreamEntry::description).toList()));
            }
            if (!invalid.isEmpty()) {
                parts.add("Twitch の URL として読めませんでした: " + summarize(invalid));
            }
            if (parts.isEmpty()) {
                return "Twitch の URL かチャンネル名が見つかりませんでした";
            }
            return String.join(" / ", parts);
        }

        /** 1 件も追加できず、追加済みだったわけでもないときは失敗として見せる。 */
        public boolean failed() {
            return added.isEmpty() && duplicates.isEmpty();
        }

        private static String summarize(List<String> items) {
            int max = 3;
            List<String> head = items.subList(0, Math.min(max, items.size())).stream()
                    .map(s -> s.length() > 40 ? s.substring(0, 39) + "…" : s)
                    .toList();
            String text = String.join(", ", head);
            return items.size() > max ? text + " ほか " + (items.size() - max) + " 件" : text;
        }
    }

    private final Object lock = new Object();
    private final List<StreamEntry> entries = new ArrayList<>();
    private final List<Runnable> listeners = new CopyOnWriteArrayList<>();
    private final Path storage;
    private long version;

    /** @param storage 一覧の保存先。{@code null} なら保存しない */
    public MultiViewState(Path storage) {
        this.storage = storage;
    }

    public static Path defaultStorage() {
        return Path.of(System.getProperty("user.home"), ".twitch-multiview", "streams.txt");
    }

    /** 保存しておいた一覧を読み戻す。 */
    public void load() {
        if (storage == null || !Files.isRegularFile(storage)) {
            return;
        }
        List<String> lines;
        try {
            lines = Files.readAllLines(storage, StandardCharsets.UTF_8);
        } catch (IOException e) {
            System.err.println("保存した一覧を読めませんでした: " + e.getMessage());
            return;
        }
        boolean changed = false;
        synchronized (lock) {
            for (String line : lines) {
                String s = line.strip();
                if (s.isEmpty() || s.startsWith("#")) {
                    continue;
                }
                var entry = TwitchUrlParser.parseOne(s);
                if (entry.isPresent() && indexOf(entry.get().key()) < 0) {
                    entries.add(entry.get());
                    changed = true;
                }
            }
            if (changed) {
                version++;
            }
        }
        if (changed) {
            fire();
        }
    }

    /** 貼り付けられた文字列を読んで追加する。 */
    public AddResult addText(String text) {
        TwitchUrlParser.Result parsed = TwitchUrlParser.parse(text);
        return add(parsed.entries(), parsed.invalid());
    }

    /** 読み取り済みの配信を末尾に追加する。すでにあるものは追加しない。 */
    public AddResult add(List<StreamEntry> candidates, List<String> invalid) {
        List<StreamEntry> added = new ArrayList<>();
        List<StreamEntry> duplicates = new ArrayList<>();
        synchronized (lock) {
            for (StreamEntry e : candidates) {
                if (indexOf(e.key()) >= 0) {
                    duplicates.add(e);
                } else {
                    entries.add(e);
                    added.add(e);
                }
            }
            if (!added.isEmpty()) {
                changed();
            }
        }
        if (!added.isEmpty()) {
            fire();
        }
        return new AddResult(List.copyOf(added), List.copyOf(duplicates), List.copyOf(invalid));
    }

    public boolean remove(String key) {
        synchronized (lock) {
            int i = indexOf(key);
            if (i < 0) {
                return false;
            }
            entries.remove(i);
            changed();
        }
        fire();
        return true;
    }

    /** {@code key} の配信を {@code to} 番目（0 始まり、範囲外は端に寄せる）へ動かす。 */
    public boolean move(String key, int to) {
        synchronized (lock) {
            int from = indexOf(key);
            if (from < 0) {
                return false;
            }
            int target = Math.max(0, Math.min(to, entries.size() - 1));
            if (target == from) {
                return false;
            }
            entries.add(target, entries.remove(from));
            changed();
        }
        fire();
        return true;
    }

    public void clear() {
        synchronized (lock) {
            if (entries.isEmpty()) {
                return;
            }
            entries.clear();
            changed();
        }
        fire();
    }

    public Snapshot snapshot() {
        synchronized (lock) {
            return new Snapshot(version, List.copyOf(entries));
        }
    }

    /** 一覧が変わるたびに呼ばれる（呼ばれるスレッドは決まっていない）。 */
    public void addListener(Runnable listener) {
        listeners.add(listener);
    }

    private int indexOf(String key) {
        for (int i = 0; i < entries.size(); i++) {
            if (entries.get(i).key().equals(key)) {
                return i;
            }
        }
        return -1;
    }

    /** lock を持った状態で呼ぶ。 */
    private void changed() {
        version++;
        save();
    }

    private void save() {
        if (storage == null) {
            return;
        }
        try {
            Path dir = storage.toAbsolutePath().getParent();
            if (dir != null) {
                Files.createDirectories(dir);
            }
            Path tmp = storage.resolveSibling(storage.getFileName() + ".tmp");
            Files.write(tmp, entries.stream().map(StreamEntry::url).toList(), StandardCharsets.UTF_8);
            Files.move(tmp, storage, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            System.err.println("一覧を保存できませんでした: " + e.getMessage());
        }
    }

    private void fire() {
        for (Runnable listener : listeners) {
            try {
                listener.run();
            } catch (RuntimeException e) {
                e.printStackTrace();
            }
        }
    }
}
