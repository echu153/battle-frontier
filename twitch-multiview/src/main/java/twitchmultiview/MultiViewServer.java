package twitchmultiview;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.BindException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 複窓ページを配る小さな HTTP サーバー。自分の PC（127.0.0.1）からしか繋がらない。
 *
 * <pre>
 * GET  /                 複窓ページ
 * GET  /api/state        今の一覧（JSON）
 * POST /api/add          本文の文字列を読んで追加
 * POST /api/remove?key=  1 枠消す
 * POST /api/move?key=&amp;to=  並べ替え
 * POST /api/clear        全部消す
 * </pre>
 */
public final class MultiViewServer {

    private static final String PAGE_RESOURCE = "/twitchmultiview/multiview.html";
    private static final int MAX_BODY = 64 * 1024;

    private final MultiViewState state;
    private final byte[] page;
    /** ツールを起動し直したことをブラウザ側が気づけるように、起動ごとに変える。 */
    private final String instance = UUID.randomUUID().toString();
    private HttpServer server;
    private ExecutorService executor;

    public MultiViewServer(MultiViewState state) {
        this.state = state;
        this.page = loadPage();
    }

    /**
     * {@code firstPort} から順に空いているポートを探して起動する。
     *
     * @param firstPort 最初に試すポート。0 なら OS に任せる
     * @param attempts  何個のポートを試すか
     */
    public void start(int firstPort, int attempts) throws IOException {
        BindException lastError = null;
        for (int i = 0; i < Math.max(1, attempts) && server == null; i++) {
            int port = firstPort == 0 ? 0 : firstPort + i;
            try {
                server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), 0);
            } catch (BindException e) {
                lastError = e;
            }
        }
        if (server == null) {
            throw lastError;
        }
        executor = Executors.newFixedThreadPool(4, r -> {
            Thread t = new Thread(r, "multiview-http");
            t.setDaemon(true);
            return t;
        });
        server.setExecutor(executor);
        server.createContext("/", this::handle);
        server.start();
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
            executor.shutdownNow();
        }
    }

    public int port() {
        return server.getAddress().getPort();
    }

    /** ブラウザで開く URL。Twitch の埋め込みは parent=localhost で許可されるので localhost で開く。 */
    public String url() {
        return "http://localhost:" + port() + "/";
    }

    private void handle(HttpExchange ex) throws IOException {
        try {
            if (!hostAllowed(ex)) {
                sendJson(ex, 403, "{\"message\":\"forbidden\"}");
                return;
            }
            String path = ex.getRequestURI().getPath();
            switch (path) {
                case "/", "/index.html" -> {
                    if (requireMethod(ex, "GET")) {
                        send(ex, 200, "text/html; charset=utf-8", page);
                    }
                }
                case "/favicon.ico" -> send(ex, 204, "text/plain", new byte[0]);
                case "/api/state" -> {
                    if (requireMethod(ex, "GET")) {
                        sendJson(ex, 200, stateJson());
                    }
                }
                case "/api/add" -> {
                    if (requirePost(ex)) {
                        String body = readBody(ex);
                        if (body != null) {
                            MultiViewState.AddResult r = state.addText(body);
                            sendJson(ex, 200, "{\"added\":" + r.added().size()
                                    + ",\"duplicates\":" + r.duplicates().size()
                                    + ",\"invalid\":" + r.invalid().size()
                                    + ",\"failed\":" + r.failed()
                                    + ",\"message\":" + quote(r.message()) + "}");
                        }
                    }
                }
                case "/api/remove" -> {
                    if (requirePost(ex)) {
                        sendOk(ex, state.remove(query(ex).getOrDefault("key", "")));
                    }
                }
                case "/api/move" -> {
                    if (requirePost(ex)) {
                        Map<String, String> q = query(ex);
                        int to;
                        try {
                            to = Integer.parseInt(q.getOrDefault("to", ""));
                        } catch (NumberFormatException e) {
                            sendJson(ex, 400, "{\"message\":\"to が数字ではありません\"}");
                            return;
                        }
                        sendOk(ex, state.move(q.getOrDefault("key", ""), to));
                    }
                }
                case "/api/clear" -> {
                    if (requirePost(ex)) {
                        state.clear();
                        sendOk(ex, true);
                    }
                }
                default -> sendJson(ex, 404, "{\"message\":\"not found\"}");
            }
        } catch (RuntimeException e) {
            e.printStackTrace();
            sendJson(ex, 500, "{\"message\":" + quote(String.valueOf(e.getMessage())) + "}");
        } finally {
            ex.close();
        }
    }

    String stateJson() {
        MultiViewState.Snapshot snap = state.snapshot();
        StringBuilder sb = new StringBuilder(256);
        sb.append("{\"instance\":").append(quote(instance))
                .append(",\"version\":").append(snap.version())
                .append(",\"streams\":[");
        List<StreamEntry> entries = snap.entries();
        for (int i = 0; i < entries.size(); i++) {
            StreamEntry e = entries.get(i);
            if (i > 0) {
                sb.append(',');
            }
            sb.append("{\"key\":").append(quote(e.key()))
                    .append(",\"type\":").append(quote(e.type().code()))
                    .append(",\"id\":").append(quote(e.id()))
                    .append(",\"time\":").append(quote(e.time()))
                    .append(",\"label\":").append(quote(e.label()))
                    .append(",\"url\":").append(quote(e.url()))
                    .append('}');
        }
        return sb.append("]}").toString();
    }

    // ---- 安全確認 ----

    /** DNS リバインディング対策: localhost 以外の名前で来たリクエストは断る。 */
    private boolean hostAllowed(HttpExchange ex) {
        String host = ex.getRequestHeaders().getFirst("Host");
        return host == null || allowedAuthorities().contains(host.toLowerCase(Locale.ROOT));
    }

    /** よそのサイトから勝手に一覧を書き換えられないよう、変更系は同じページからのみ受け付ける。 */
    private boolean originAllowed(HttpExchange ex) {
        String origin = ex.getRequestHeaders().getFirst("Origin");
        if (origin == null) {
            return true; // ブラウザ以外（curl など）
        }
        String o = origin.toLowerCase(Locale.ROOT);
        return o.startsWith("http://") && allowedAuthorities().contains(o.substring("http://".length()));
    }

    private Set<String> allowedAuthorities() {
        int p = port();
        return Set.of("localhost:" + p, "127.0.0.1:" + p, "[::1]:" + p);
    }

    private static boolean requireMethod(HttpExchange ex, String method) throws IOException {
        if (method.equals(ex.getRequestMethod())) {
            return true;
        }
        ex.getResponseHeaders().set("Allow", method);
        sendJson(ex, 405, "{\"message\":\"method not allowed\"}");
        return false;
    }

    private boolean requirePost(HttpExchange ex) throws IOException {
        if (!requireMethod(ex, "POST")) {
            return false;
        }
        if (!originAllowed(ex)) {
            sendJson(ex, 403, "{\"message\":\"forbidden origin\"}");
            return false;
        }
        return true;
    }

    // ---- 入出力 ----

    private static String readBody(HttpExchange ex) throws IOException {
        byte[] body = ex.getRequestBody().readNBytes(MAX_BODY + 1);
        if (body.length > MAX_BODY) {
            sendJson(ex, 413, "{\"message\":\"too large\"}");
            return null;
        }
        return new String(body, StandardCharsets.UTF_8);
    }

    private static Map<String, String> query(HttpExchange ex) {
        Map<String, String> map = new HashMap<>();
        String raw = ex.getRequestURI().getRawQuery();
        if (raw == null) {
            return map;
        }
        for (String pair : raw.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                try {
                    map.putIfAbsent(URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8),
                            URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
                } catch (IllegalArgumentException ignored) {
                    // 壊れた % エスケープは無視
                }
            }
        }
        return map;
    }

    private static void sendOk(HttpExchange ex, boolean ok) throws IOException {
        sendJson(ex, 200, "{\"ok\":" + ok + "}");
    }

    private static void sendJson(HttpExchange ex, int status, String json) throws IOException {
        send(ex, status, "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8));
    }

    private static void send(HttpExchange ex, int status, String contentType, byte[] body) throws IOException {
        Headers h = ex.getResponseHeaders();
        h.set("Content-Type", contentType);
        h.set("Cache-Control", "no-store");
        h.set("X-Content-Type-Options", "nosniff");
        if (body.length == 0) {
            ex.sendResponseHeaders(status, -1);
            return;
        }
        ex.sendResponseHeaders(status, body.length);
        try (OutputStream out = ex.getResponseBody()) {
            out.write(body);
        }
    }

    /** JSON の文字列リテラルにする。HTML に埋め込まれても安全なように &lt; &gt; &amp; も逃がす。 */
    static String quote(String s) {
        if (s == null) {
            return "null";
        }
        StringBuilder sb = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20 || c == '<' || c == '>' || c == '&' || c == ' ' || c == ' ') {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        return sb.append('"').toString();
    }

    private static byte[] loadPage() {
        try (InputStream in = MultiViewServer.class.getResourceAsStream(PAGE_RESOURCE)) {
            if (in == null) {
                throw new IllegalStateException(PAGE_RESOURCE + " が見つかりません。"
                        + "src/main/resources をクラスパスに入れて起動してください（run.sh / run.bat を使うと自動で入ります）。");
            }
            return in.readAllBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
