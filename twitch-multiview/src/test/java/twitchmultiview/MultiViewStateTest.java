package twitchmultiview;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MultiViewStateTest {

    private static List<String> keys(MultiViewState state) {
        return state.snapshot().entries().stream().map(StreamEntry::key).toList();
    }

    @Test
    void addsAndSkipsDuplicates() {
        MultiViewState state = new MultiViewState(null);
        var first = state.addText("https://www.twitch.tv/a https://www.twitch.tv/b");
        assertEquals(2, first.added().size());
        assertEquals("2 件追加しました", first.message());

        var second = state.addText("twitch.tv/B twitch.tv/c");
        assertEquals(List.of(StreamEntry.live("c")), second.added());
        assertEquals(List.of(StreamEntry.live("b")), second.duplicates());
        assertEquals("1 件追加しました / 追加済み: [ライブ] b", second.message());
        assertEquals(List.of("live:a", "live:b", "live:c"), keys(state));
    }

    @Test
    void reportsFailures() {
        MultiViewState state = new MultiViewState(null);
        var r = state.addText("https://www.youtube.com/watch?v=1");
        assertTrue(r.failed());
        assertEquals("Twitch の URL として読めませんでした: https://www.youtube.com/watch?v=1", r.message());

        var nothing = state.addText("   ");
        assertTrue(nothing.failed());
        assertEquals("Twitch の URL かチャンネル名が見つかりませんでした", nothing.message());

        state.addText("a");
        assertFalse(state.addText("a").failed(), "追加済みは失敗扱いにしない");
    }

    @Test
    void movesRemovesAndClears() {
        MultiViewState state = new MultiViewState(null);
        state.addText("a b c");
        long v = state.snapshot().version();

        assertTrue(state.move("live:c", 0));
        assertEquals(List.of("live:c", "live:a", "live:b"), keys(state));
        assertTrue(state.move("live:c", 99));
        assertEquals(List.of("live:a", "live:b", "live:c"), keys(state));
        assertFalse(state.move("live:c", 2), "同じ位置なら何もしない");
        assertFalse(state.move("live:zzz", 0));

        assertTrue(state.remove("live:b"));
        assertFalse(state.remove("live:b"));
        assertEquals(List.of("live:a", "live:c"), keys(state));
        assertEquals(v + 3, state.snapshot().version());

        state.clear();
        assertTrue(state.snapshot().entries().isEmpty());
    }

    @Test
    void notifiesListenersOnlyOnChange() {
        MultiViewState state = new MultiViewState(null);
        AtomicInteger calls = new AtomicInteger();
        state.addListener(calls::incrementAndGet);
        state.addText("a");
        state.addText("a");
        state.remove("live:nope");
        state.clear();
        state.clear();
        assertEquals(2, calls.get());
    }

    @Test
    void savesAndRestores(@TempDir Path dir) throws Exception {
        Path file = dir.resolve("sub").resolve("streams.txt");
        MultiViewState state = new MultiViewState(file);
        state.addText("https://www.twitch.tv/a https://www.twitch.tv/videos/5?t=90 https://clips.twitch.tv/Clip-X");
        state.move("clip:Clip-X", 0);

        assertEquals(List.of(
                "https://clips.twitch.tv/Clip-X",
                "https://www.twitch.tv/a",
                "https://www.twitch.tv/videos/5?t=1m30s"), Files.readAllLines(file));

        MultiViewState restored = new MultiViewState(file);
        restored.load();
        assertEquals(state.snapshot().entries(), restored.snapshot().entries());
    }

    @Test
    void loadSkipsBrokenLines(@TempDir Path dir) throws Exception {
        Path file = dir.resolve("streams.txt");
        Files.writeString(file, "# メモ\n\nhttps://www.twitch.tv/a\nなにか\nhttps://www.twitch.tv/a\n");
        MultiViewState state = new MultiViewState(file);
        state.load();
        assertEquals(List.of("live:a"), keys(state));
    }
}
