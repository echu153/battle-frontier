import { A as supabase, d as reportDevAccess, n as BattleLogLine } from "../_fuzz.bundle.mjs";
import { r as simulatePvpBattle, t as loadLoadout } from "./pvpLoadout-ynYqlb67.js";
import { useEffect, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/components/ArenaPanel.jsx
var FLOORS = 20;
function ArenaPanel({ onClose }) {
	const [meId, setMeId] = useState(null);
	const [blocked, setBlocked] = useState(false);
	const [myLoadout, setMyLoadout] = useState(null);
	const [board, setBoard] = useState(null);
	const [myFloor, setMyFloor] = useState(null);
	const [targetFloor, setTargetFloor] = useState(1);
	const [lastAt, setLastAt] = useState(null);
	const [cdSeconds, setCdSeconds] = useState(3600);
	const [now, setNow] = useState(Date.now());
	const [logs, setLogs] = useState([]);
	const [winner, setWinner] = useState(null);
	const [oppName, setOppName] = useState(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const listRef = useRef(null);
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 1e3);
		return () => clearInterval(t);
	}, []);
	const reloadBoard = async () => {
		const { data, error: e } = await supabase.rpc("arena_get_board");
		if (e || !data || data.ok === false) {
			setError("盤面の取得に失敗: " + (data?.reason || e?.message || "unknown"));
			setBoard([]);
			return;
		}
		setBoard(data.board || []);
		setMyFloor(data.my_floor ?? null);
		setTargetFloor(data.target_floor || 1);
		setLastAt(data.last_challenge_at || null);
		setCdSeconds(data.cooldown_seconds || 3600);
	};
	useEffect(() => {
		(async () => {
			const { data: { user } } = await supabase.auth.getUser();
			if (!user) return;
			const { data: me } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
			if (!me?.is_admin) {
				reportDevAccess("arena", "アリーナパネル");
				setBlocked(true);
				return;
			}
			setMeId(user.id);
			try {
				const [mine] = await Promise.all([loadLoadout(user.id, true), reloadBoard()]);
				setMyLoadout(mine);
			} catch (e) {
				setError("データ読込に失敗: " + e.message);
			}
		})();
	}, []);
	const cdLeft = (() => {
		if (!lastAt) return 0;
		const elapsed = (now - new Date(lastAt).getTime()) / 1e3;
		return Math.max(0, Math.ceil(cdSeconds - elapsed));
	})();
	const fmtCd = (s) => `${Math.floor(s / 60)}分${String(s % 60).padStart(2, "0")}秒`;
	const myEff = myLoadout?.eff;
	const targetSlot = (board || []).find((s) => s.floor === targetFloor) || null;
	const targetOccupied = !!targetSlot?.holder_id;
	const claimEmpty = async () => {
		if (busy || !myEff) return;
		setBusy(true);
		setError("");
		setNotice("");
		setLogs([]);
		setWinner(null);
		try {
			const { data, error: e } = await supabase.rpc("arena_claim_empty", {
				p_floor: targetFloor,
				p_hp_max: Math.floor(myEff.hp_max),
				p_mp_max: Math.floor(myEff.mp_max)
			});
			if (e || data?.ok === false) setError("着席に失敗: " + (data?.reason || e?.message || "unknown"));
			else setNotice(`${targetFloor}階に着席しました！ 守護中は挑戦できません（負けると次の階へ）。`);
			await reloadBoard();
		} catch (e) {
			setError("着席処理に失敗: " + e.message);
		} finally {
			setBusy(false);
		}
	};
	const challenge = async () => {
		if (busy || !myLoadout || !myEff || !targetSlot?.holder_id) return;
		if (cdLeft > 0) {
			setError(`クールダウン中です（あと${fmtCd(cdLeft)}）`);
			return;
		}
		setBusy(true);
		setError("");
		setNotice("");
		setLogs([]);
		setWinner(null);
		setOppName(targetSlot.username || "守護者");
		try {
			const oppLoadout = await loadLoadout(targetSlot.holder_id, false);
			if (!oppLoadout.skillSets.length) setNotice("相手の出撃スキルが未設定です（相手は通常攻撃のみ）");
			const res = simulatePvpBattle(myLoadout, oppLoadout, {
				startHpB: targetSlot.hp_current,
				startMpB: targetSlot.mp_current
			});
			setLogs(res.logs);
			setWinner(res.winner);
			const won = res.winner === "A";
			const { data, error: e } = await supabase.rpc("arena_battle_result", {
				p_floor: targetFloor,
				p_opponent: targetSlot.holder_id,
				p_won: won,
				p_def_end_hp: Math.floor(res.endHpB),
				p_def_end_mp: Math.floor(res.endMpB),
				p_my_hp_max: Math.floor(myEff.hp_max),
				p_my_mp_max: Math.floor(myEff.mp_max)
			});
			if (e || data?.ok === false) setError("結果の反映に失敗: " + (data?.reason || e?.message || "unknown") + "（盤面を再取得します）");
			else if (won) setNotice(`勝利！ ${targetFloor}階を獲得しました！${data.level_ups ? ` ★LV UP×${data.level_ups}！` : ""} EXP+${data.exp_gained ?? 0}`);
			else setNotice(`敗北… 目標を${Math.max(1, targetFloor - 1)}階に下げました。 EXP+${data.exp_gained ?? 0}`);
			await reloadBoard();
		} catch (e) {
			setError("挑戦処理に失敗: " + e.message);
		} finally {
			setBusy(false);
		}
	};
	const classColor = "#c8a0ff";
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
				background: "#0a0616",
				border: "1px solid #6a3a9a",
				padding: "24px",
				textAlign: "center",
				color: "#b088dd",
				fontSize: "13px",
				lineHeight: "1.9"
			},
			children: [
				"🏛 アリーナは現在【開発中】です。",
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
				background: "#0a0616",
				border: "1px solid #6a3a9a",
				maxWidth: "720px",
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
						borderBottom: "1px solid #3a1f5a",
						paddingBottom: "8px"
					},
					children: [/* @__PURE__ */ jsx("div", {
						style: {
							color: classColor,
							fontSize: "15px",
							letterSpacing: "2px"
						},
						children: "🏛 アリーナ"
					}), /* @__PURE__ */ jsx("button", {
						onClick: onClose,
						style: {
							background: "none",
							border: "1px solid #6a44a0",
							color: "#aa77cc",
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
						color: "#aa88cc",
						fontSize: "10px",
						lineHeight: "1.7",
						marginBottom: "10px"
					},
					children: [
						"全",
						/* @__PURE__ */ jsxs("b", { children: [FLOORS, "階"] }),
						"の梯子。",
						/* @__PURE__ */ jsx("b", { children: "目標の階" }),
						"に挑戦し、空席なら着席・占有なら戦闘（",
						/* @__PURE__ */ jsx("b", { children: "1時間に1回" }),
						"・EXP+20）。勝てばその階を守護、負ければ目標が1つ下へ。守護中は挑戦できません。",
						/* @__PURE__ */ jsx("b", { children: "持続HP" }),
						"は挑戦されるたびに削れます（回復なし）。"
					]
				}),
				board === null && !error && /* @__PURE__ */ jsx("div", {
					style: {
						color: "#8877aa",
						fontSize: "12px"
					},
					children: "データを読込中..."
				}),
				board !== null && /* @__PURE__ */ jsx("div", {
					style: {
						border: "1px solid #6a3a9a",
						background: "#120a24",
						padding: "10px",
						marginBottom: "10px"
					},
					children: myFloor != null ? /* @__PURE__ */ jsxs("div", {
						style: {
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							flexWrap: "wrap",
							gap: "6px"
						},
						children: [/* @__PURE__ */ jsxs("div", {
							style: {
								color: "#d0a0ff",
								fontSize: "13px"
							},
							children: [
								"🛡 ",
								/* @__PURE__ */ jsxs("b", { children: [myFloor, "階"] }),
								"を守護中"
							]
						}), /* @__PURE__ */ jsx("div", {
							style: {
								color: "#8877aa",
								fontSize: "10px"
							},
							children: "守護中は挑戦できません（負けると次の階へ）"
						})]
					}) : /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsxs("div", {
						style: {
							color: "#c8a0ff",
							fontSize: "12px",
							marginBottom: "8px"
						},
						children: [
							"次の目標: ",
							/* @__PURE__ */ jsxs("b", {
								style: { color: "#ffcc66" },
								children: [targetFloor, "階"]
							}),
							targetOccupied ? /* @__PURE__ */ jsxs("span", {
								style: { color: "#aa88cc" },
								children: [
									"（守護者: ",
									targetSlot.username || "???",
									"）"
								]
							}) : /* @__PURE__ */ jsx("span", {
								style: { color: "#66aa88" },
								children: "（空席）"
							})
						]
					}), targetOccupied ? /* @__PURE__ */ jsx("button", {
						onClick: challenge,
						disabled: busy || cdLeft > 0 || !myEff,
						style: {
							width: "100%",
							padding: "12px",
							background: busy || cdLeft > 0 ? "#160a1e" : "#2a0a2a",
							border: `1px solid ${busy || cdLeft > 0 ? "#3a2a4a" : "#c060e0"}`,
							color: busy || cdLeft > 0 ? "#665577" : "#ff9aff",
							cursor: busy || cdLeft > 0 ? "not-allowed" : "pointer",
							fontFamily: "monospace",
							fontSize: "13px",
							letterSpacing: "1px"
						},
						children: busy ? "戦闘中..." : cdLeft > 0 ? `⏳ クールダウン中（あと${fmtCd(cdLeft)}）` : `⚔ ${targetFloor}階に挑戦する`
					}) : /* @__PURE__ */ jsx("button", {
						onClick: claimEmpty,
						disabled: busy || !myEff,
						style: {
							width: "100%",
							padding: "12px",
							background: "#0a2a1a",
							border: "1px solid #3aa060",
							color: "#66dd99",
							cursor: busy ? "not-allowed" : "pointer",
							fontFamily: "monospace",
							fontSize: "13px",
							letterSpacing: "1px"
						},
						children: busy ? "処理中..." : `🪑 ${targetFloor}階に着席する（空席・EXPなし）`
					})] })
				}),
				notice && /* @__PURE__ */ jsx("div", {
					style: {
						color: "#ffcc66",
						fontSize: "11px",
						marginBottom: "8px"
					},
					children: notice
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
						background: "#0a0612",
						padding: "10px",
						marginBottom: "10px"
					},
					children: [winner && /* @__PURE__ */ jsx("div", {
						style: {
							textAlign: "center",
							marginBottom: "8px",
							color: winner === "A" ? "#ffcc44" : "#ff6699",
							fontSize: "14px"
						},
						children: winner === "A" ? `🏆 ${myLoadout?.profile?.username} の勝利！` : `💀 ${oppName} の防衛成功…`
					}), /* @__PURE__ */ jsx("div", {
						style: {
							maxHeight: "40vh",
							overflowY: "auto"
						},
						children: logs.map((l, i) => /* @__PURE__ */ jsx(BattleLogLine, { l }, i))
					})]
				}),
				board !== null && /* @__PURE__ */ jsx("div", {
					ref: listRef,
					style: {
						display: "grid",
						gap: "4px",
						maxHeight: "46vh",
						overflowY: "auto"
					},
					children: [...board].sort((a, b) => b.floor - a.floor).map((s) => {
						const isMine = s.holder_id && s.holder_id === meId;
						const isTarget = myFloor == null && s.floor === targetFloor;
						const hpPct = s.holder_id && s.hp_max ? Math.max(0, Math.min(1, s.hp_current / s.hp_max)) : 0;
						return /* @__PURE__ */ jsxs("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: "8px",
								padding: "6px 8px",
								background: isMine ? "#1a2a12" : isTarget ? "#2a1a0a" : "#0e0a18",
								border: `1px solid ${isMine ? "#4a8a3a" : isTarget ? "#c08a3a" : "#2a1f3a"}`
							},
							children: [/* @__PURE__ */ jsxs("div", {
								style: {
									width: "42px",
									flexShrink: 0,
									color: "#b088e0",
									fontSize: "11px",
									textAlign: "center"
								},
								children: [/* @__PURE__ */ jsx("b", { children: s.floor }), "階"]
							}), s.holder_id ? /* @__PURE__ */ jsxs(Fragment, { children: [
								s.avatar_url ? /* @__PURE__ */ jsx("img", {
									src: s.avatar_url,
									alt: "",
									style: {
										width: "26px",
										height: "26px",
										objectFit: "cover",
										border: "1px solid #3a2f5a",
										flexShrink: 0
									}
								}) : /* @__PURE__ */ jsx("div", { style: {
									width: "26px",
									height: "26px",
									background: "#1a1230",
									border: "1px solid #3a2f5a",
									flexShrink: 0
								} }),
								/* @__PURE__ */ jsxs("div", {
									style: {
										flex: 1,
										minWidth: 0
									},
									children: [/* @__PURE__ */ jsxs("div", {
										style: {
											color: isMine ? "#a8ff88" : "#d8c0ff",
											fontSize: "11px",
											whiteSpace: "nowrap",
											overflow: "hidden",
											textOverflow: "ellipsis"
										},
										children: [
											s.username || "???",
											" ",
											isMine && /* @__PURE__ */ jsx("span", {
												style: { color: "#66dd88" },
												children: "(あなた)"
											}),
											/* @__PURE__ */ jsxs("span", {
												style: {
													color: "#6a5a8a",
													fontSize: "9px"
												},
												children: [
													" LV",
													s.char_lv,
													"・",
													s.class
												]
											})
										]
									}), /* @__PURE__ */ jsxs("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: "6px",
											marginTop: "2px"
										},
										children: [/* @__PURE__ */ jsx("div", {
											style: {
												flex: 1,
												height: "5px",
												background: "#1a1228",
												border: "1px solid #2a1f3a",
												maxWidth: "120px"
											},
											children: /* @__PURE__ */ jsx("div", { style: {
												width: `${hpPct * 100}%`,
												height: "100%",
												background: hpPct > .4 ? "#44cc66" : hpPct > .15 ? "#ccaa33" : "#cc4444"
											} })
										}), /* @__PURE__ */ jsxs("span", {
											style: {
												color: "#7a6a9a",
												fontSize: "8px"
											},
											children: [
												"HP ",
												s.hp_current,
												"/",
												s.hp_max
											]
										})]
									})]
								}),
								/* @__PURE__ */ jsxs("div", {
									style: {
										flexShrink: 0,
										textAlign: "right"
									},
									children: [/* @__PURE__ */ jsx("div", {
										style: {
											color: "#ffcc66",
											fontSize: "9px"
										},
										children: s.streak > 0 ? `${s.streak}連勝中` : "守護中"
									}), s.defeated_name && /* @__PURE__ */ jsxs("div", {
										style: {
											color: "#6a5a8a",
											fontSize: "8px"
										},
										children: [s.defeated_name, "に勝利"]
									})]
								})
							] }) : /* @__PURE__ */ jsxs("div", {
								style: {
									flex: 1,
									color: "#4a4060",
									fontSize: "10px"
								},
								children: ["― 空席 ―", isTarget && /* @__PURE__ */ jsx("span", {
									style: { color: "#66aa88" },
									children: "（挑戦で着席）"
								})]
							})]
						}, s.floor);
					})
				})
			]
		})
	});
}
//#endregion
export { ArenaPanel as default };
