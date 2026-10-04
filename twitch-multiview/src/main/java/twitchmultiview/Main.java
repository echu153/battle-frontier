package twitchmultiview;

import javax.swing.SwingUtilities;
import java.awt.GraphicsEnvironment;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Twitch 複窓ツール。
 *
 * <p>手元で小さな Web サーバーを立て、Twitch の埋め込みプレイヤーをタイル状に並べたページをブラウザで開く。
 * URL は Java の操作画面・ブラウザのページのどちらに貼っても追加でき、両者は自動で同期する。
 */
public final class Main {

    static final int DEFAULT_PORT = 17878;

    private static final String USAGE = """
            使い方: java -jar twitch-multiview.jar [オプション] [URL かチャンネル名 ...]

              --port <番号>   使うポート（既定 %d。使用中なら次の番号を順に試す）
              --nogui         操作画面を出さない（ブラウザのページだけで操作する）
              --no-browser    起動時にブラウザを開かない
              --no-save       一覧を保存しない・前回の一覧を読まない
              -h, --help      この説明を出す

            例: java -jar twitch-multiview.jar https://www.twitch.tv/shroud xqc
            """.formatted(DEFAULT_PORT);

    private record Options(int port, boolean portGiven, boolean gui, boolean openBrowser, boolean save,
                           boolean help, List<String> inputs) {

        static Options parse(String[] args) {
            int port = DEFAULT_PORT;
            boolean portGiven = false;
            boolean gui = true;
            boolean openBrowser = true;
            boolean save = true;
            boolean help = false;
            List<String> inputs = new ArrayList<>();
            for (int i = 0; i < args.length; i++) {
                String a = args[i];
                switch (a) {
                    case "--port" -> {
                        if (i + 1 >= args.length) {
                            throw new IllegalArgumentException("--port の後にポート番号を書いてください");
                        }
                        try {
                            port = Integer.parseInt(args[++i]);
                        } catch (NumberFormatException e) {
                            throw new IllegalArgumentException("ポート番号が数字ではありません: " + args[i]);
                        }
                        if (port < 0 || port > 65535) {
                            throw new IllegalArgumentException("ポート番号は 0〜65535 で指定してください: " + port);
                        }
                        portGiven = true;
                    }
                    case "--nogui", "--no-gui" -> gui = false;
                    case "--no-browser" -> openBrowser = false;
                    case "--no-save" -> save = false;
                    case "-h", "--help" -> help = true;
                    default -> {
                        if (a.startsWith("--")) {
                            throw new IllegalArgumentException("知らないオプションです: " + a);
                        }
                        inputs.add(a);
                    }
                }
            }
            return new Options(port, portGiven, gui, openBrowser, save, help, inputs);
        }
    }

    private Main() {}

    public static void main(String[] args) {
        Options opt;
        try {
            opt = Options.parse(args);
        } catch (IllegalArgumentException e) {
            System.err.println(e.getMessage());
            System.err.print(USAGE);
            System.exit(2);
            return;
        }
        if (opt.help()) {
            System.out.print(USAGE);
            return;
        }

        MultiViewState state = new MultiViewState(opt.save() ? MultiViewState.defaultStorage() : null);
        state.load();
        if (!opt.inputs().isEmpty()) {
            // 引数は 1 つずつ URL かチャンネル名として読む（まとめて読むと URL と並んだチャンネル名を読み飛ばすため）
            List<StreamEntry> entries = new ArrayList<>();
            List<String> invalid = new ArrayList<>();
            for (String input : opt.inputs()) {
                TwitchUrlParser.parseOne(input).ifPresentOrElse(entries::add, () -> invalid.add(input));
            }
            System.out.println(state.add(entries, invalid).message());
        }

        MultiViewServer server = new MultiViewServer(state);
        try {
            server.start(opt.port(), opt.portGiven() ? 1 : 10);
        } catch (IOException e) {
            System.err.println("ポート " + opt.port() + " でサーバーを起動できませんでした: " + e.getMessage());
            System.err.println("--port で別の番号を指定してみてください。");
            System.exit(1);
            return;
        }
        String url = server.url();
        System.out.println("複窓ページ: " + url);

        boolean gui = opt.gui() && !GraphicsEnvironment.isHeadless();
        if (gui) {
            SwingUtilities.invokeLater(() -> new ControlPanel(state, server).show());
        } else {
            System.out.println("Ctrl+C で終了します。");
        }
        if (opt.openBrowser()) {
            Browser.openAsync(url, ok -> {
                if (!ok) {
                    System.out.println("ブラウザを開けませんでした。上の URL をブラウザで開いてください。");
                }
            });
        }
    }
}
