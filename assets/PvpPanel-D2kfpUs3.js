import { A as supabase, d as reportDevAccess, n as BattleLogLine } from "../_fuzz.bundle.mjs";
import { r as simulatePvpBattle, t as loadLoadout } from "./pvpLoadout-ynYqlb67.js";
import { useEffect, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/components/PvpPanel.jsx
function PvpPanel({ onClose }) {
	const [meId, setMeId] = useState(null);
	const [blocked, setBlocked] = useState(false);
	const [myLoadout, setMyLoadout] = useState(null);
	const [search, setSearch] = useState("");
	const [results, setResults] = useState([]);
	const [searching, setSearching] = useState(false);
	const [opponent, setOpponent] = useState(null);
	const [logs, setLogs] = useState([]);
	const [winner, setWinner] = useState(null);
	const [battling, setBattling] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		(async () => {
			const { data: { user } } = await supabase.auth.getUser();
			if (!user) return;
			const { data: me } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
			if (!me?.is_admin) {
				reportDevAccess("pvp", "対人戦パネル");
				setBlocked(true);
				return;
			}
			setMeId(user.id);
			try {
				setMyLoadout(await loadLoadout(user.id, true));
			} catch (e) {
				setError("自分のデータ読込に失敗: " + e.message);
			}
		})();
	}, []);
	const doSearch = async () => {
		const q = search.trim();
		if (!q) return;
		setSearching(true);
		setError("");
		const { data } = await supabase.from("profiles").select("id, username, char_lv, class").ilike("username", `%${q}%`).limit(20);
		setResults((data || []).filter((p) => p.id !== meId));
		setSearching(false);
	};
	const runBattle = async () => {
		if (!opponent || !myLoadout || battling) return;
		setBattling(true);
		setError("");
		setLogs([]);
		setWinner(null);
		try {
			const oppLoadout = await loadLoadout(opponent.id, false);
			if (!oppLoadout.skillSets.length) setError("相手の出撃スキルが未設定です（全て通常攻撃になります）");
			const { logs: blogs, winner: w, turns, aHpPct, bHpPct } = simulatePvpBattle(myLoadout, oppLoadout, { hpBonus: 2e4 });
			setLogs(blogs);
			setWinner(w);
			try {
				await supabase.rpc("pvp_record_result", {
					p_opponent: opponent.id,
					p_winner: w === "A" ? "challenger" : w === "B" ? "opponent" : "draw",
					p_turns: turns,
					p_a_hp_pct: aHpPct,
					p_b_hp_pct: bHpPct
				});
			} catch {}
		} catch (e) {
			setError("対戦処理に失敗: " + e.message);
		} finally {
			setBattling(false);
		}
	};
	if (blocked) return /* @__PURE__ */ jsx("div", {
		style: {
			position: "fixed",
			inset: 0,
			background: "rgba(0,0,0,0.85)",
			zIndex: 2e3,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			padding: "16px",
			fontFamily: "monospace"
		},
		children: /* @__PURE__ */ jsxs("div", {
			style: {
				background: "#0a0612",
				border: "1px solid #6a3a9a",
				padding: "24px",
				textAlign: "center",
				color: "#b088dd",
				fontSize: "13px",
				lineHeight: "1.9"
			},
			children: [
				"⚔ 対人戦は現在【開発中】です。",
				/* @__PURE__ */ jsx("br", {}),
				"調整が完了するまでお待ちください。",
				/* @__PURE__ */ jsx("br", {}),
				/* @__PURE__ */ jsx("button", {
					onClick: onClose,
					style: {
						marginTop: "12px",
						padding: "6px 16px",
						background: "none",
						border: "1px solid #6644aa",
						color: "#9977cc",
						cursor: "pointer",
						fontFamily: "monospace",
						fontSize: "12px"
					},
					children: "閉じる"
				})
			]
		})
	});
	return /* @__PURE__ */ jsx("div", {
		style: {
			position: "fixed",
			inset: 0,
			background: "rgba(0,0,0,0.85)",
			zIndex: 2e3,
			display: "flex",
			alignItems: "flex-start",
			justifyContent: "center",
			padding: "16px",
			overflowY: "auto",
			fontFamily: "monospace"
		},
		children: /* @__PURE__ */ jsxs("div", {
			style: {
				background: "#0a0612",
				border: "1px solid #6a3a9a",
				maxWidth: "680px",
				width: "100%",
				padding: "16px",
				marginTop: "24px"
			},
			children: [
				/* @__PURE__ */ jsxs("div", {
					style: {
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						marginBottom: "12px",
						borderBottom: "1px solid #2a1f5a",
						paddingBottom: "8px"
					},
					children: [/* @__PURE__ */ jsxs("div", {
						style: {
							color: "#e0b0ff",
							fontSize: "15px",
							letterSpacing: "2px"
						},
						children: ["⚔ 対人戦 ", /* @__PURE__ */ jsx("span", {
							style: {
								color: "#7766aa",
								fontSize: "10px"
							},
							children: "(開発者限定)"
						})]
					}), /* @__PURE__ */ jsx("button", {
						onClick: onClose,
						style: {
							background: "none",
							border: "1px solid #6644aa",
							color: "#9977cc",
							padding: "4px 10px",
							cursor: "pointer",
							fontFamily: "monospace",
							fontSize: "11px"
						},
						children: "✕ 閉じる"
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					style: {
						color: "#88aacc",
						fontSize: "10px",
						lineHeight: "1.7",
						marginBottom: "10px"
					},
					children: [
						"与ダメージは防御力で大きく軽減／回復は通常どおり／素早さによる補正は無し。スキルはお互いの",
						/* @__PURE__ */ jsx("b", { children: "出撃" }),
						"セットを反映。素早さが速い方が先攻。"
					]
				}),
				!myLoadout && !error && /* @__PURE__ */ jsx("div", {
					style: {
						color: "#9977aa",
						fontSize: "12px"
					},
					children: "自分のデータを読込中..."
				}),
				/* @__PURE__ */ jsxs("div", {
					style: {
						display: "flex",
						gap: "6px",
						marginBottom: "8px"
					},
					children: [/* @__PURE__ */ jsx("input", {
						value: search,
						onChange: (e) => setSearch(e.target.value),
						onKeyDown: (e) => e.key === "Enter" && doSearch(),
						placeholder: "相手のユーザー名で検索",
						style: {
							flex: 1,
							background: "#120a22",
							border: "1px solid #4a2a6a",
							color: "#e0d0ff",
							padding: "8px",
							fontFamily: "monospace",
							fontSize: "12px"
						}
					}), /* @__PURE__ */ jsx("button", {
						onClick: doSearch,
						disabled: searching,
						style: {
							background: "#2a1040",
							border: "1px solid #a060ff",
							color: "#d0a0ff",
							padding: "8px 14px",
							cursor: "pointer",
							fontFamily: "monospace",
							fontSize: "12px"
						},
						children: searching ? "..." : "検索"
					})]
				}),
				results.length > 0 && /* @__PURE__ */ jsx("div", {
					style: {
						display: "grid",
						gap: "4px",
						marginBottom: "10px",
						maxHeight: "140px",
						overflowY: "auto"
					},
					children: results.map((p) => /* @__PURE__ */ jsxs("button", {
						onClick: () => {
							setOpponent(p);
							setResults([]);
							setSearch(p.username);
						},
						style: {
							textAlign: "left",
							background: "#140c22",
							border: "1px solid #4a2a6a",
							color: "#c8a0ff",
							padding: "6px 10px",
							cursor: "pointer",
							fontFamily: "monospace",
							fontSize: "11px"
						},
						children: [
							p.username,
							" ",
							/* @__PURE__ */ jsxs("span", {
								style: { color: "#7766aa" },
								children: [
									"LV",
									p.char_lv,
									"・",
									p.class
								]
							})
						]
					}, p.id))
				}),
				opponent && /* @__PURE__ */ jsxs("div", {
					style: {
						border: "1px solid #6a3a9a",
						background: "#140c22",
						padding: "10px",
						marginBottom: "10px",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center"
					},
					children: [/* @__PURE__ */ jsxs("div", {
						style: {
							color: "#e0b0ff",
							fontSize: "13px"
						},
						children: [
							"対戦相手: ",
							/* @__PURE__ */ jsx("b", { children: opponent.username }),
							" ",
							/* @__PURE__ */ jsxs("span", {
								style: {
									color: "#7766aa",
									fontSize: "10px"
								},
								children: [
									"LV",
									opponent.char_lv,
									"・",
									opponent.class
								]
							})
						]
					}), /* @__PURE__ */ jsx("button", {
						onClick: runBattle,
						disabled: battling || !myLoadout,
						style: {
							background: battling ? "#140a1c" : "#2a1040",
							border: `1px solid ${battling ? "#3a2a4a" : "#a060ff"}`,
							color: battling ? "#5a4a6a" : "#d0a0ff",
							padding: "8px 18px",
							cursor: battling ? "not-allowed" : "pointer",
							fontFamily: "monospace",
							fontSize: "12px",
							letterSpacing: "1px"
						},
						children: battling ? "戦闘中..." : "⚔ 対戦"
					})]
				}),
				error && /* @__PURE__ */ jsx("div", {
					style: {
						color: "#ff8899",
						fontSize: "11px",
						marginBottom: "8px"
					},
					children: error
				}),
				logs.length > 0 && /* @__PURE__ */ jsxs("div", {
					style: {
						border: "1px solid #4a2a6a",
						background: "#0c0716",
						padding: "10px"
					},
					children: [winner && /* @__PURE__ */ jsx("div", {
						style: {
							textAlign: "center",
							marginBottom: "8px",
							color: winner === "draw" ? "#aaaaaa" : "#ffcc44",
							fontSize: "14px"
						},
						children: winner === "A" ? `🏆 ${myLoadout?.profile?.username} の勝利！` : winner === "B" ? `💀 ${opponent?.username} の勝利…` : "🤝 引き分け"
					}), /* @__PURE__ */ jsx("div", {
						style: {
							maxHeight: "50vh",
							overflowY: "auto"
						},
						children: logs.map((l, i) => /* @__PURE__ */ jsx(BattleLogLine, { l }, i))
					})]
				})
			]
		})
	});
}
//#endregion
export { PvpPanel as default };
