package twitchmultiview;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TwitchUrlParserTest {

    private static StreamEntry one(String input) {
        return TwitchUrlParser.parseOne(input).orElseThrow(() -> new AssertionError("読めなかった: " + input));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "https://www.twitch.tv/Shroud",
            "https://twitch.tv/shroud/",
            "http://www.twitch.tv/shroud",
            "twitch.tv/shroud",
            "www.twitch.tv/shroud?sr=a",
            "https://m.twitch.tv/shroud",
            "https://www.twitch.tv/shroud/videos",
            "https://www.twitch.tv/shroud/about#x",
            "https://www.twitch.tv/popout/shroud/chat?popout=",
            "https://www.twitch.tv/embed/shroud/chat?parent=example.com",
            "https://www.twitch.tv/moderator/shroud",
            "https://player.twitch.tv/?channel=shroud&parent=example.com",
            "shroud",
            "@Shroud",
            "「https://www.twitch.tv/shroud」",
            "<https://www.twitch.tv/shroud>",
            "https://www.twitch.tv/shroud。",
    })
    void readsLiveChannels(String input) {
        assertEquals(StreamEntry.live("shroud"), one(input));
    }

    @Test
    void readsArchives() {
        assertEquals(StreamEntry.vod("123456789", null), one("https://www.twitch.tv/videos/123456789"));
        assertEquals(StreamEntry.vod("123456789", "1h2m3s"), one("https://www.twitch.tv/videos/123456789?t=1h2m3s"));
        assertEquals(StreamEntry.vod("42", null), one("https://www.twitch.tv/shroud/v/42"));
        assertEquals(StreamEntry.vod("42", null), one("https://m.twitch.tv/videos/42"));
        assertEquals(StreamEntry.vod("42", "10m0s"), one("https://player.twitch.tv/?video=v42&time=10m&parent=x"));
    }

    @ParameterizedTest
    @CsvSource({
            "1h2m3s, 1h2m3s",
            "90s, 1m30s",
            "90, 1m30s",
            "3600, 1h0m0s",
            "2m, 2m0s",
            "5s, 5s",
            "0s, ",
            "abc, ",
            "'', ",
    })
    void normalizesStartTime(String raw, String expected) {
        assertEquals(expected, TwitchUrlParser.normalizeTime(raw));
    }

    @Test
    void ignoresBrokenStartTime() {
        assertNull(one("https://www.twitch.tv/videos/1?t=abc").time());
    }

    @Test
    void readsClipsKeepingCase() {
        assertEquals(StreamEntry.clip("FunnySlug-ab_C1"), one("https://clips.twitch.tv/FunnySlug-ab_C1"));
        assertEquals(StreamEntry.clip("FunnySlug-x"), one("https://www.twitch.tv/shroud/clip/FunnySlug-x?filter=clips"));
        assertEquals(StreamEntry.clip("Slug"), one("https://clips.twitch.tv/embed?clip=Slug&parent=example.com"));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "",
            "https://www.youtube.com/watch?v=abc",
            "https://www.twitch.tv/",
            "https://www.twitch.tv/directory/category/just-chatting",
            "https://www.twitch.tv/search?term=a",
            "https://www.twitch.tv/videos/",
            "https://www.twitch.tv/videos/abc",
            "https://twitch.tv.example.com/shroud",
            "https://example.com/twitch.tv/shroud",
            "ftp://twitch.tv/shroud",
            "javascript:alert(1)",
            "https://clips.twitch.tv/",
            "https://player.twitch.tv/?parent=x",
            "配信",
            "this_name_is_far_too_long_for_twitch",
    })
    void rejectsOtherThings(String input) {
        assertTrue(TwitchUrlParser.parseOne(input).isEmpty(), input);
    }

    @Test
    void readsSeveralAtOnce() {
        var r = TwitchUrlParser.parse("https://twitch.tv/a\nhttps://twitch.tv/b, https://www.twitch.tv/videos/1　twitch.tv/c");
        assertEquals(List.of(StreamEntry.live("a"), StreamEntry.live("b"), StreamEntry.vod("1", null), StreamEntry.live("c")),
                r.entries());
        assertEquals(List.of(), r.invalid());
    }

    @Test
    void picksOnlyTwitchUrlsOutOfSentences() {
        var r = TwitchUrlParser.parse("配信中です！ 見てね https://www.twitch.tv/abc #ゲーム実況");
        assertEquals(List.of(StreamEntry.live("abc")), r.entries());
        assertEquals(List.of(), r.invalid());
    }

    @Test
    void readsBareChannelNamesAndReportsTheRest() {
        var r = TwitchUrlParser.parse("shroud xqc https://www.youtube.com/watch?v=1");
        assertEquals(List.of(StreamEntry.live("shroud"), StreamEntry.live("xqc")), r.entries());
        assertEquals(List.of("https://www.youtube.com/watch?v=1"), r.invalid());
    }

    @Test
    void emptyTextGivesNothing() {
        var r = TwitchUrlParser.parse("  \n ");
        assertTrue(r.entries().isEmpty());
        assertTrue(r.invalid().isEmpty());
        assertTrue(TwitchUrlParser.parse(null).entries().isEmpty());
    }
}
