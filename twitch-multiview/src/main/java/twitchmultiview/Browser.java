package twitchmultiview;

import java.awt.Desktop;
import java.awt.GraphicsEnvironment;
import java.io.IOException;
import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;

/** いつものブラウザで URL を開く。 */
final class Browser {

    private Browser() {}

    /** 環境によっては開くまで待たされるので、別スレッドで開く。 */
    static void openAsync(String url, Consumer<Boolean> done) {
        Thread t = new Thread(() -> {
            boolean ok = open(url);
            if (done != null) {
                done.accept(ok);
            }
        }, "open-browser");
        t.setDaemon(true);
        t.start();
    }

    static boolean open(String url) {
        try {
            if (!GraphicsEnvironment.isHeadless()
                    && Desktop.isDesktopSupported()
                    && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(URI.create(url));
                return true;
            }
        } catch (Exception | LinkageError e) {
            // 下の OS コマンドで試す
        }
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        List<String> command;
        if (os.contains("win")) {
            command = List.of("rundll32", "url.dll,FileProtocolHandler", url);
        } else if (os.contains("mac")) {
            command = List.of("open", url);
        } else {
            command = List.of("xdg-open", url);
        }
        try {
            new ProcessBuilder(command)
                    .redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .start();
            return true;
        } catch (IOException e) {
            return false;
        }
    }
}
