package twitchmultiview;

import javax.swing.AbstractAction;
import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.DefaultListCellRenderer;
import javax.swing.DefaultListModel;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComponent;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextField;
import javax.swing.KeyStroke;
import javax.swing.ListSelectionModel;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.TransferHandler;
import javax.swing.UIManager;
import javax.swing.WindowConstants;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.GridLayout;
import java.awt.Toolkit;
import java.awt.datatransfer.Clipboard;
import java.awt.datatransfer.DataFlavor;
import java.awt.datatransfer.UnsupportedFlavorException;
import java.awt.event.ActionEvent;
import java.awt.event.KeyEvent;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.io.IOException;
import java.util.List;
import java.util.Locale;

/**
 * Java 側の操作画面。URL を貼って一覧を作り、ブラウザの複窓ページを開く。
 *
 * <p>入力欄に貼って Enter のほか、一覧で Ctrl+V・ウィンドウへのドラッグ＆ドロップ・
 * 「コピーした URL を自動で追加」でも追加できる。
 */
final class ControlPanel {

    private static final String TITLE = "Twitch 複窓ツール";
    private static final Color ERROR_COLOR = new Color(0xC62828);

    private final MultiViewState state;
    private final MultiViewServer server;

    private final DefaultListModel<StreamEntry> model = new DefaultListModel<>();
    private final JList<StreamEntry> list = new JList<>(model);
    private final JTextField input = new JTextField();
    private final JLabel status = new JLabel(" ");
    private final JButton upButton = new JButton("↑ 前へ");
    private final JButton downButton = new JButton("↓ 後ろへ");
    private final JButton removeButton = new JButton("削除");
    private final JButton clearButton = new JButton("全部消す");
    private final JCheckBox watchClipboard = new JCheckBox("コピーした Twitch の URL を自動で追加");
    private final Timer clipboardTimer = new Timer(800, e -> pollClipboard());
    private String lastClipboard;
    private Color normalStatusColor;
    private JFrame frame;

    ControlPanel(MultiViewState state, MultiViewServer server) {
        this.state = state;
        this.server = server;
    }

    void show() {
        try {
            UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
        } catch (Exception ignored) {
            // 既定の見た目のまま
        }
        frame = new JFrame(TITLE);
        frame.setDefaultCloseOperation(WindowConstants.EXIT_ON_CLOSE);
        frame.setContentPane(buildContent());
        frame.setMinimumSize(new Dimension(480, 360));
        frame.setSize(620, 480);
        frame.setLocationRelativeTo(null);

        state.addListener(() -> SwingUtilities.invokeLater(this::reload));
        reload();
        frame.setVisible(true);
        input.requestFocusInWindow();
    }

    private JComponent buildContent() {
        JPanel root = new JPanel(new BorderLayout(0, 10));
        root.setBorder(BorderFactory.createEmptyBorder(12, 12, 12, 12));

        // 上: 入力欄
        JButton addButton = new JButton("追加");
        JButton pasteButton = new JButton("クリップボードから追加");
        JPanel inputRow = new JPanel(new BorderLayout(6, 0));
        inputRow.add(input, BorderLayout.CENTER);
        inputRow.add(addButton, BorderLayout.EAST);
        JPanel clipRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
        clipRow.add(pasteButton);
        clipRow.add(Box.createHorizontalStrut(12));
        clipRow.add(watchClipboard);
        JPanel top = new JPanel(new BorderLayout(0, 6));
        top.add(new JLabel("Twitch の URL かチャンネル名を貼り付けて Enter（改行・スペース区切りで複数OK）"),
                BorderLayout.NORTH);
        top.add(inputRow, BorderLayout.CENTER);
        top.add(clipRow, BorderLayout.SOUTH);

        // 中: 一覧と並べ替え
        list.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        list.setCellRenderer(new EntryRenderer());
        list.setTransferHandler(new TextImportHandler());
        list.setToolTipText("");
        JPanel buttons = new JPanel(new GridLayout(0, 1, 0, 6));
        buttons.add(upButton);
        buttons.add(downButton);
        buttons.add(removeButton);
        buttons.add(clearButton);
        JPanel side = new JPanel(new BorderLayout());
        side.add(buttons, BorderLayout.NORTH);
        JPanel center = new JPanel(new BorderLayout(8, 0));
        center.add(new JScrollPane(list), BorderLayout.CENTER);
        center.add(side, BorderLayout.EAST);

        // 下: ブラウザを開く・状態表示
        JButton openButton = new JButton("ブラウザで複窓を開く");
        JTextField urlField = new JTextField(server.url());
        urlField.setEditable(false);
        urlField.setToolTipText("このアドレスをブラウザで開いても同じです");
        JPanel openRow = new JPanel(new BorderLayout(6, 0));
        openRow.add(openButton, BorderLayout.WEST);
        openRow.add(urlField, BorderLayout.CENTER);
        JPanel bottom = new JPanel(new BorderLayout(0, 6));
        bottom.add(openRow, BorderLayout.NORTH);
        bottom.add(status, BorderLayout.SOUTH);
        normalStatusColor = status.getForeground();

        root.add(top, BorderLayout.NORTH);
        root.add(center, BorderLayout.CENTER);
        root.add(bottom, BorderLayout.SOUTH);
        // ウィンドウのどこに URL を落としても追加する
        root.setTransferHandler(new TextImportHandler());

        input.addActionListener(e -> addFromInput());
        addButton.addActionListener(e -> addFromInput());
        pasteButton.addActionListener(e -> {
            String text = readClipboard();
            if (text == null || text.isBlank()) {
                showStatus("クリップボードに文字が入っていません", true);
            } else {
                addText(text);
            }
        });
        watchClipboard.addActionListener(e -> toggleClipboardWatch());
        openButton.addActionListener(e -> Browser.openAsync(server.url(), ok -> {
            if (!ok) {
                SwingUtilities.invokeLater(() ->
                        showStatus("ブラウザを開けませんでした。下の URL をブラウザで開いてください", true));
            }
        }));
        upButton.addActionListener(e -> moveSelected(-1));
        downButton.addActionListener(e -> moveSelected(1));
        removeButton.addActionListener(e -> removeSelected());
        clearButton.addActionListener(e -> {
            if (!model.isEmpty() && JOptionPane.showConfirmDialog(frame, "一覧をすべて消しますか？", TITLE,
                    JOptionPane.YES_NO_OPTION) == JOptionPane.YES_OPTION) {
                state.clear();
                showStatus("すべて消しました", false);
            }
        });
        list.addListSelectionListener(e -> updateButtons());
        list.getInputMap().put(KeyStroke.getKeyStroke(KeyEvent.VK_DELETE, 0), "removeEntry");
        list.getInputMap().put(KeyStroke.getKeyStroke(KeyEvent.VK_BACK_SPACE, 0), "removeEntry");
        list.getActionMap().put("removeEntry", new AbstractAction() {
            @Override
            public void actionPerformed(ActionEvent e) {
                removeSelected();
            }
        });
        list.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 2 && list.getSelectedValue() != null) {
                    Browser.openAsync(list.getSelectedValue().url(), null);
                }
            }
        });
        return root;
    }

    private void addFromInput() {
        String text = input.getText();
        if (text.isBlank()) {
            input.requestFocusInWindow();
            return;
        }
        MultiViewState.AddResult r = addText(text);
        if (!r.failed()) {
            input.setText("");
        }
    }

    private MultiViewState.AddResult addText(String text) {
        MultiViewState.AddResult r = state.addText(text);
        showStatus(r.message(), r.failed());
        if (!r.added().isEmpty()) {
            selectKey(r.added().get(r.added().size() - 1).key());
        }
        return r;
    }

    private void moveSelected(int delta) {
        int i = list.getSelectedIndex();
        if (i >= 0) {
            state.move(model.get(i).key(), i + delta);
        }
    }

    private void removeSelected() {
        int i = list.getSelectedIndex();
        if (i < 0) {
            return;
        }
        StreamEntry e = model.get(i);
        state.remove(e.key());
        showStatus("消しました: " + e.description(), false);
        // 消した位置の次を選んでおくと続けて消しやすい
        SwingUtilities.invokeLater(() -> {
            if (!model.isEmpty()) {
                list.setSelectedIndex(Math.min(i, model.size() - 1));
            }
        });
    }

    /** 一覧を作り直す。選んでいた項目は並べ替え後も選んだままにする。 */
    private void reload() {
        StreamEntry selected = list.getSelectedValue();
        List<StreamEntry> entries = state.snapshot().entries();
        model.clear();
        model.addAll(entries);
        if (selected != null) {
            selectKey(selected.key());
        }
        updateButtons();
        frame.setTitle(entries.isEmpty() ? TITLE : TITLE + "（" + entries.size() + " 枠）");
    }

    private void selectKey(String key) {
        for (int i = 0; i < model.size(); i++) {
            if (model.get(i).key().equals(key)) {
                list.setSelectedIndex(i);
                list.ensureIndexIsVisible(i);
                return;
            }
        }
    }

    private void updateButtons() {
        int i = list.getSelectedIndex();
        upButton.setEnabled(i > 0);
        downButton.setEnabled(i >= 0 && i < model.size() - 1);
        removeButton.setEnabled(i >= 0);
        clearButton.setEnabled(!model.isEmpty());
    }

    private void showStatus(String text, boolean error) {
        status.setText(text);
        status.setToolTipText(text);
        status.setForeground(error ? ERROR_COLOR : normalStatusColor);
    }

    // ---- クリップボード ----

    private void toggleClipboardWatch() {
        if (watchClipboard.isSelected()) {
            // 今入っているものは追加しない。ここから先にコピーされたものだけ拾う
            lastClipboard = readClipboard();
            clipboardTimer.start();
            showStatus("Twitch の URL をコピーすると自動で追加します", false);
        } else {
            clipboardTimer.stop();
            showStatus("自動追加を止めました", false);
        }
    }

    private void pollClipboard() {
        String text = readClipboard();
        if (text == null || text.equals(lastClipboard)) {
            return;
        }
        lastClipboard = text;
        if (text.toLowerCase(Locale.ROOT).contains("twitch.tv")) {
            addText(text);
        }
    }

    private static String readClipboard() {
        try {
            Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
            if (!clipboard.isDataFlavorAvailable(DataFlavor.stringFlavor)) {
                return null;
            }
            return (String) clipboard.getData(DataFlavor.stringFlavor);
        } catch (IllegalStateException | UnsupportedFlavorException | IOException e) {
            return null; // ほかのアプリが使用中など。次の機会に読む
        }
    }

    /** 一覧での Ctrl+V と、ウィンドウへのドラッグ＆ドロップを受ける。 */
    private final class TextImportHandler extends TransferHandler {
        @Override
        public boolean canImport(TransferSupport support) {
            return support.isDataFlavorSupported(DataFlavor.stringFlavor);
        }

        @Override
        public boolean importData(TransferSupport support) {
            if (!canImport(support)) {
                return false;
            }
            try {
                addText((String) support.getTransferable().getTransferData(DataFlavor.stringFlavor));
                return true;
            } catch (UnsupportedFlavorException | IOException e) {
                return false;
            }
        }
    }

    private static final class EntryRenderer extends DefaultListCellRenderer {
        @Override
        public Component getListCellRendererComponent(JList<?> list, Object value, int index,
                                                      boolean selected, boolean focused) {
            super.getListCellRendererComponent(list, value, index, selected, focused);
            if (value instanceof StreamEntry e) {
                setText((index + 1) + ".  " + e.description());
                setToolTipText(e.url() + "（ダブルクリックで Twitch を開く）");
            }
            setBorder(BorderFactory.createEmptyBorder(4, 8, 4, 8));
            return this;
        }
    }
}
