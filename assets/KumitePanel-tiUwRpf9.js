import { A as supabase, n as BattleLogLine } from "../_fuzz.bundle.mjs";
import { n as loadTotalCandidates, r as simulatePvpBattle, t as loadLoadout } from "./pvpLoadout-ynYqlb67.js";
import { useEffect, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/components/KumitePanel.jsx
var MATCH_RANGE = .1;
var TOP_N = 10;
var totalFromEff = (eff) => Math.floor(eff.hp_max / 10 + eff.mp_max / 5 + eff.atk + eff.def + eff.matk + eff.mdef + eff.spd);
function KumitePanel({ onClose }) {
	const [, setMeId] = useState(null);
	const [myLoadout, setMyLoadout] = useState(null);
	const [myTotal, setMyTotal] = useState(null);
	const [candidates, setCandidates] = useState(null);
	const [opponent, setOpponent] = useState(null);
	const [logs, setLogs] = useState([]);
	const [winner, setWinner] = useState(null);
	const [battling, setBattling] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	useEffect(() => {
		(async () => {
			const { data: { user } } = await supabase.auth.getUser();
			if (!user) return;
			setMeId(user.id);
			try {
				const [mine, cands] = await Promise.all([loadLoadout(user.id, true), loadTotalCandidates(user.id)]);
				setMyLoadout(mine);
				setMyTotal(totalFromEff(mine.eff));
				setCandidates(cands);
			} catch (e) {
				setError("データ読込に失敗: " + e.message);
				setCandidates([]);
			}
		})();
	}, []);
	const top10 = (candidates || []).slice(0, TOP_N);
	const pickRandom = () => {
		setError("");
		setNotice("");
		setOpponent(null);
		setLogs([]);
		setWinner(null);
		if (myTotal == null || !candidates) return;
		const lo = myTotal * (1 - MATCH_RANGE), hi = myTotal * 1.1;
		const pool = candidates.filter((c) => c._total >= lo && c._total <= hi);
		if (pool.length === 0) {
			setNotice(`総合力±10%（${Math.floor(lo)}〜${Math.ceil(hi)}）の相手が見つかりませんでした。`);
			return;
		}
		const pick = pool[Math.floor(Math.random() * pool.length)];
		setOpponent(pick);
		setNotice(`ランダムマッチ成立！ 候補${pool.length}人から選出。`);
	};
	const selectOpponent = (c) => {
		setError("");
		setNotice("");
		setLogs([]);
		setWinner(null);
		setOpponent(c);
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
			const { logs: blogs, winner: w, turns, aHpPct, bHpPct } = simulatePvpBattle(myLoadout, oppLoadout);
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
				background: "#06101a",
				border: "1px solid #3a6a9a",
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
						borderBottom: "1px solid #1f3a5a",
						paddingBottom: "8px"
					},
					children: [/* @__PURE__ */ jsxs("div", {
						style: {
							color: "#8ad0ff",
							fontSize: "15px",
							letterSpacing: "2px"
						},
						children: ["🥊 組み手 ", /* @__PURE__ */ jsx("span", {
							style: {
								color: "#667799",
								fontSize: "10px"
							},
							children: "(開発者限定)"
						})]
					}), /* @__PURE__ */ jsx("button", {
						onClick: onClose,
						style: {
							background: "none",
							border: "1px solid #44668a",
							color: "#77aacc",
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
						"対人戦の練習施設。",
						/* @__PURE__ */ jsx("b", { children: "総合力±10%" }),
						"の相手とランダムマッチ、または",
						/* @__PURE__ */ jsxs("b", { children: [
							"総合力上位",
							TOP_N,
							"人"
						] }),
						"から選んで対戦できます。報酬はありません。お互いの",
						/* @__PURE__ */ jsx("b", { children: "出撃" }),
						"スキルで戦います。"
					]
				}),
				candidates === null && !error && /* @__PURE__ */ jsx("div", {
					style: {
						color: "#7799aa",
						fontSize: "12px"
					},
					children: "データを読込中..."
				}),
				myTotal != null && /* @__PURE__ */ jsxs("div", {
					style: {
						color: "#aaccee",
						fontSize: "11px",
						marginBottom: "10px"
					},
					children: ["あなたの総合力: ", /* @__PURE__ */ jsx("b", {
						style: { color: "#44ff88" },
						children: myTotal
					})]
				}),
				candidates !== null && /* @__PURE__ */ jsx("button", {
					onClick: pickRandom,
					disabled: battling,
					style: {
						width: "100%",
						padding: "12px",
						marginBottom: "10px",
						background: "#0a1a2a",
						border: "1px solid #3aa0e0",
						color: "#8ad0ff",
						cursor: "pointer",
						fontFamily: "monospace",
						fontSize: "13px",
						letterSpacing: "1px"
					},
					children: "🎲 ランダムマッチ（総合力±10%）"
				}),
				notice && /* @__PURE__ */ jsx("div", {
					style: {
						color: "#ffcc66",
						fontSize: "11px",
						marginBottom: "8px"
					},
					children: notice
				}),
				top10.length > 0 && /* @__PURE__ */ jsxs("div", {
					style: { marginBottom: "10px" },
					children: [/* @__PURE__ */ jsxs("div", {
						style: {
							color: "#77aacc",
							fontSize: "11px",
							marginBottom: "6px"
						},
						children: [
							"総合力 上位",
							TOP_N,
							"人から選ぶ"
						]
					}), /* @__PURE__ */ jsx("div", {
						style: {
							display: "grid",
							gap: "4px",
							maxHeight: "200px",
							overflowY: "auto"
						},
						children: top10.map((c, i) => /* @__PURE__ */ jsxs("button", {
							onClick: () => selectOpponent(c),
							style: {
								textAlign: "left",
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								background: opponent?.id === c.id ? "#13304a" : "#0a1622",
								border: `1px solid ${opponent?.id === c.id ? "#3aa0e0" : "#244a6a"}`,
								color: "#a8d0ff",
								padding: "6px 10px",
								cursor: "pointer",
								fontFamily: "monospace",
								fontSize: "11px"
							},
							children: [/* @__PURE__ */ jsxs("span", { children: [
								/* @__PURE__ */ jsxs("span", {
									style: { color: "#667799" },
									children: [i + 1, "."]
								}),
								" ",
								c.username,
								" ",
								/* @__PURE__ */ jsxs("span", {
									style: { color: "#667799" },
									children: [
										"LV",
										c.char_lv,
										"・",
										c.class
									]
								})
							] }), /* @__PURE__ */ jsx("span", {
								style: { color: "#44ff88" },
								children: c._total
							})]
						}, c.id))
					})]
				}),
				candidates !== null && top10.length === 0 && /* @__PURE__ */ jsx("div", {
					style: {
						color: "#556677",
						fontSize: "11px",
						marginBottom: "10px"
					},
					children: "対戦できる相手がいません。"
				}),
				opponent && /* @__PURE__ */ jsxs("div", {
					style: {
						border: "1px solid #3a6a9a",
						background: "#0a1622",
						padding: "10px",
						marginBottom: "10px",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center"
					},
					children: [/* @__PURE__ */ jsxs("div", {
						style: {
							color: "#8ad0ff",
							fontSize: "13px"
						},
						children: [
							"対戦相手: ",
							/* @__PURE__ */ jsx("b", { children: opponent.username }),
							" ",
							/* @__PURE__ */ jsxs("span", {
								style: {
									color: "#667799",
									fontSize: "10px"
								},
								children: [
									"LV",
									opponent.char_lv,
									"・",
									opponent.class,
									"・総合力",
									opponent._total
								]
							})
						]
					}), /* @__PURE__ */ jsx("button", {
						onClick: runBattle,
						disabled: battling || !myLoadout,
						style: {
							background: battling ? "#0a141c" : "#0a2a40",
							border: `1px solid ${battling ? "#2a3a4a" : "#3aa0e0"}`,
							color: battling ? "#445566" : "#8ad0ff",
							padding: "8px 18px",
							cursor: battling ? "not-allowed" : "pointer",
							fontFamily: "monospace",
							fontSize: "12px",
							letterSpacing: "1px"
						},
						children: battling ? "戦闘中..." : "🥊 対戦"
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
						border: "1px solid #244a6a",
						background: "#060e16",
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
export { KumitePanel as default };
