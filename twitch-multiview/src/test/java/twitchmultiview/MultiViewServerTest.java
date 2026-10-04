package twitchmultiview;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MultiViewServerTest {

    private final HttpClient client = HttpClient.newBuilder().proxy(HttpClient.Builder.NO_PROXY).build();
    private MultiViewState state;
    private MultiViewServer server;

    @BeforeEach
    void start() throws IOException {
        state = new MultiViewState(null);
        server = new MultiViewServer(state);
        server.start(0, 1);
    }

    @AfterEach
    void stop() {
        server.stop();
    }

    private HttpResponse<String> get(String path) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create(server.url() + path.substring(1))).GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> post(String path, String body, String origin) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(server.url() + path.substring(1)))
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        if (origin != null) {
            b.header("Origin", origin);
        }
        return client.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void servesPage() throws Exception {
        var res = get("/");
        assertEquals(200, res.statusCode());
        assertTrue(res.headers().firstValue("Content-Type").orElse("").startsWith("text/html"));
        assertTrue(res.body().contains("player.twitch.tv/js/embed/v1.js"));
    }

    @Test
    void addMoveRemoveThroughApi() throws Exception {
        String origin = "http://localhost:" + server.port();
        var add = post("/api/add", "https://www.twitch.tv/a\nhttps://www.twitch.tv/videos/9?t=1m\ntwitch.tv/b", origin);
        assertEquals(200, add.statusCode());
        assertEquals("{\"added\":3,\"duplicates\":0,\"invalid\":0,\"failed\":false,\"message\":\"3 件追加しました\"}",
                add.body());

        assertEquals("{\"ok\":true}", post("/api/move?key=live%3Ab&to=0", "", origin).body());
        assertEquals("{\"ok\":true}", post("/api/remove?key=live:a", "", origin).body());
        assertEquals(List.of("live:b", "vod:9"),
                state.snapshot().entries().stream().map(StreamEntry::key).toList());

        String json = get("/api/state").body();
        assertTrue(json.contains("\"version\":3"), json);
        assertTrue(json.contains("{\"key\":\"live:b\",\"type\":\"live\",\"id\":\"b\",\"time\":null,\"label\":\"b\","
                + "\"url\":\"https://www.twitch.tv/b\"}"), json);
        assertTrue(json.contains("\"time\":\"1m0s\""), json);

        assertEquals(400, post("/api/move?key=live:b&to=x", "", origin).statusCode());
        assertEquals("{\"ok\":true}", post("/api/clear", "", null).body());
        assertTrue(state.snapshot().entries().isEmpty());
    }

    @Test
    void rejectsOtherSites() throws Exception {
        assertEquals(403, post("/api/add", "a", "https://evil.example").statusCode());
        assertEquals(403, post("/api/add", "a", "null").statusCode());
        assertEquals(403, post("/api/add", "a", "http://localhost:1").statusCode());
        assertTrue(state.snapshot().entries().isEmpty());
    }

    @Test
    void rejectsForeignHostHeader() throws Exception {
        assertTrue(rawGet("evil.example:" + server.port()).startsWith("HTTP/1.1 403"));
        assertTrue(rawGet("127.0.0.1:" + server.port()).startsWith("HTTP/1.1 200"));
    }

    /** HttpClient は Host を書き換えられないので、ソケットで直接送る。 */
    private String rawGet(String host) throws IOException {
        try (Socket socket = new Socket(InetAddress.getLoopbackAddress(), server.port())) {
            OutputStream out = socket.getOutputStream();
            out.write(("GET /api/state HTTP/1.1\r\nHost: " + host + "\r\nConnection: close\r\n\r\n")
                    .getBytes(StandardCharsets.US_ASCII));
            out.flush();
            InputStream in = socket.getInputStream();
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    void wrongMethodsAndPaths() throws Exception {
        assertEquals(405, get("/api/add").statusCode());
        assertEquals(405, post("/api/state", "", null).statusCode());
        assertEquals(404, get("/nope").statusCode());
    }

    @Test
    void quotesJsonSafely() {
        assertEquals("\"a\\\"b\\\\c\\n\\u003c/script\\u003e\"", MultiViewServer.quote("a\"b\\c\n</script>"));
        assertEquals("null", MultiViewServer.quote(null));
    }
}
