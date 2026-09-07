import { A as supabase, C as evoOnEvade, D as calcEffectiveStats, E as calcDefReduction, O as calcEffectiveTotal, S as evoMatkMult, T as evoTakenMult, _ as emblemDotMult, a as calcCritRate, b as evoAllSkillsSet, c as consumeAilmentShield, f as charmPlayerBonus, g as emblemDmgMult, h as emblemBlocksAilment, i as applyEquipmentEffects, k as getWeaponGroup, l as executeSkill, m as petStats, o as calcEvasionRate, p as petPlayerBonus, r as MULTI_HIT_SKILLS, s as calcExtraActionRate, t as BREEDER_PET_SKILLS, u as extractStatuses, v as emblemDrainAmount, w as evoOnHit, x as evoAtkMult, y as emblemResistNewAilments } from "../_fuzz.bundle.mjs";
//#region src/lib/pvp.js
var PVP = {
	ratioAtkMult: .25,
	dmgMult: .125,
	healMult: 1,
	turnCap: 60
};
function buildSide(input, key, hpBonus = 0) {
	const { equipment, skillSets, profile } = input;
	const eff = {
		...input.eff,
		hp_max: (input.eff?.hp_max || 0) + hpBonus
	};
	const equippedWeaponItem = equipment.find((e) => e.slot === "weapon" && e.equipped);
	const isMagical = getWeaponGroup(equippedWeaponItem?.weapons?.weapon_type || "sword") === "magical";
	const isArtifact = equippedWeaponItem?.bonus_effect === "artifact";
	const passiveNames = skillSets.filter((ss) => ss.skills?.type === "パッシブ").map((ss) => ss.skills.name);
	const has = (n) => passiveNames.includes(n);
	const rtCur = (profile.retraining || {})[profile.class] || 0;
	const pe = (cls) => profile.class === cls && rtCur >= 3;
	if (profile.class === "精霊召喚士" && rtCur >= 1 && has("精霊共鳴")) eff.mp_max = Math.floor(eff.mp_max * 1.2);
	let petActive = false, petHp = 0, petMaxHp = 0, petAtk = 0, petDef = 0, petMdef = 0, petAtkType = "phys", petSpecies = null;
	if (profile.class === "ブリーダー" && has("ペット召喚") && profile.activePet?.species) {
		const ps = petStats(profile.activePet);
		petAtk = ps.atk * 2;
		petDef = ps.def * 2;
		petMdef = ps.mdef * 2;
		petMaxHp = ps.maxHp * 5;
		petHp = petMaxHp;
		petAtkType = ps.atkType;
		petSpecies = profile.activePet.species;
		petActive = true;
	}
	const hasShingan = has("心眼");
	const hasBerserk = has("バーサク");
	const hasTakaNoMe = has("鷹ノ目");
	const hasKakushin = has("執行本能");
	const hasShinkoka = has("神聖加護");
	const hasTenki = has("天啓");
	const hasRokkan = has("第六感");
	const hasSeimitsu = has("精密照準");
	const hasTosoHonno = has("闘争本能");
	const hasOnmi = has("隠身");
	const passiveCritBonus = hasShingan ? 5 : 0;
	const passiveCritDmgBonus = hasOnmi && pe("暗殺者") ? .2 : 0;
	const passiveDmgMult = (hasShingan ? pe("侍") ? 1.1 : 1.05 : 1) * (hasBerserk ? pe("狂戦士") ? 1.2 : 1.15 : 1) * (hasKakushin ? pe("異端審問官") ? 1.15 : 1.1 : 1) * (hasRokkan ? pe("サイキッカー") ? 1.1 : 1.05 : 1) * (eff.weaponDmgMult || 1);
	const passiveHealMult = (hasShinkoka ? pe("聖職者") ? 1.4 : 1.2 : 1) * (hasKakushin ? .7 : 1);
	const passiveMatkMult = hasShinkoka ? 1.1 : 1;
	const passiveMpCostMult = (hasTenki ? .9 : 1) * (eff.weaponMpCostMult || 1);
	const passiveMatkMultTenki = hasTenki ? pe("賢者") ? 1.3 : 1.1 : 1;
	const passiveHitBonus = (hasRokkan ? 5 : 0) + (hasSeimitsu ? 5 : 0) + (hasTakaNoMe && pe("狩人") ? 10 : 0);
	const passiveHealReflect = hasShinkoka && pe("聖職者");
	const hasMadokenJutsu = has("魔導剣術");
	const hasHolyKnightPassive = has("聖騎士の心得");
	const expandedSkillSet = [];
	for (const ss of skillSets) {
		if (ss.skills?.type === "パッシブ") continue;
		const count = ss.use_count || 1;
		for (let i = 0; i < count; i++) expandedSkillSet.push(ss);
	}
	const effectiveSpdForCalc = hasTakaNoMe ? Math.floor(eff.spd * 1.2) : eff.spd;
	return {
		key,
		eff,
		profile,
		equipment,
		isMagical,
		isArtifact,
		equippedWeaponItem,
		effectiveSpdForCalc,
		ondmgSpdUp: eff.ondmgSpdUp || 0,
		expandedSkillSet,
		allSkillsSet: evoAllSkillsSet(skillSets),
		hp: eff.hp_max,
		mp: eff.mp_max,
		buffs: {},
		skillIndex: 0,
		prevSkillName: null,
		prevDmgSkillName: null,
		rtCur,
		pe,
		hasSpiritResonance: has("精霊共鳴"),
		hasShikigami: has("式神召喚"),
		petActive,
		petHp,
		petMaxHp,
		petAtk,
		petDef,
		petMdef,
		petAtkType,
		petSpecies,
		petBuffs: {
			reduce: 0,
			reduceTurns: 0
		},
		hasBerserk,
		hasOnmi,
		hasMadokenJutsu,
		hasHolyKnightPassive,
		hasTosoHonno,
		passiveCritBonus,
		passiveCritDmgBonus,
		passiveDmgMult,
		passiveHealMult,
		passiveMatkMult,
		passiveMpCostMult,
		passiveMatkMultTenki,
		passiveHitBonus,
		passiveHealReflect,
		playerHitBonus: (eff.hitBonus || 0) + passiveHitBonus,
		baseCritRate: calcCritRate(effectiveSpdForCalc) + passiveCritBonus + (eff.critBonus || 0)
	};
}
var defenderEnemyObj = (def) => ({
	name: def.profile.username,
	def: def.eff.def,
	mdef: def.eff.mdef,
	isPapia: false
});
function doAttack(att, def, isExtra, ctx) {
	const logs = ctx.logs;
	const turn = ctx.turn;
	const eff = att.eff;
	const attBuffs = att.buffs;
	const defBuffs = def.buffs;
	const profile = att.profile;
	const enemyName = def.profile.username;
	const enemyObj = defenderEnemyObj(def);
	const minDmg = ctx.minDmgPct > 0 ? Math.max(1, Math.floor((def.eff.hp_max || 0) * ctx.minDmgPct)) : 0;
	const holyFieldDef = attBuffs.holyField?.turns > 0 ? attBuffs.holyField.rate : 1;
	const holyKnightMult = att.hasHolyKnightPassive ? att.pe("聖騎士") ? 1.3 : 1.2 : 1;
	const kabeDefP = attBuffs.dmgReduce?.isGainoKabe && att.pe("死霊使い") ? 1.2 : 1;
	const pDef = eff.def * (attBuffs.defUp ? attBuffs.defUp.rate : 1) * holyFieldDef * holyKnightMult * kabeDefP;
	const pMdef = eff.mdef * (attBuffs.mdefUp ? attBuffs.mdefUp.rate : 1) * (attBuffs.defUp ? attBuffs.defUp.rate : 1) * holyFieldDef * holyKnightMult * kabeDefP;
	const burnDebuffP = attBuffs.burn?.turns > 0 ? .9 : 1;
	const madokenBonus = att.hasMadokenJutsu ? Math.floor(eff.matk * (att.pe("魔法剣士") ? .6 : .3)) : 0;
	const pMatk = (eff.matk - madokenBonus) * (attBuffs.matkUp ? attBuffs.matkUp.rate : 1) * att.passiveMatkMult * att.passiveMatkMultTenki * burnDebuffP * evoMatkMult(eff, att.allSkillsSet);
	const pAtk = (eff.atk + madokenBonus) * (attBuffs.atkUp ? attBuffs.atkUp.rate : 1) * (attBuffs.atkDown ? attBuffs.atkDown.rate : 1) * burnDebuffP * evoAtkMult(eff, att.allSkillsSet);
	const paralysisSpdP = attBuffs.paralysis?.turns > 0 ? attBuffs.paralysis.spdRate || .8 : 1;
	const pSpd = att.effectiveSpdForCalc * (attBuffs.spdUp ? attBuffs.spdUp.rate : 1) * paralysisSpdP;
	const effBuff = {
		...eff,
		atk: pAtk,
		def: pDef,
		mdef: pMdef,
		matk: pMatk,
		spd: pSpd
	};
	const ratioAtk = pAtk * PVP.ratioAtkMult;
	const ratioMatk = pMatk * PVP.ratioAtkMult;
	const eDefRate = (defBuffs.defDown ? defBuffs.defDown.rate : 1) * (defBuffs.defUp ? defBuffs.defUp.rate : 1) * (1 - (eff.defPen || 0));
	const eMdefRate = (defBuffs.mdefDown ? defBuffs.mdefDown.rate : 1) * (defBuffs.mdefUp ? defBuffs.mdefUp.rate : 1) * (1 - (eff.mdefPen || 0));
	const prefix = isExtra ? `${profile.username} の追加攻撃！ ` : `${turn}ターン目: ${profile.username} の`;
	const critRate = Math.max(0, att.baseCritRate - (def.eff.critResist || 0) - (defBuffs.critResist?.turns > 0 ? defBuffs.critResist.value || 0 : 0));
	const isCrit = Math.random() * 100 < critRate;
	const critMult = isCrit ? 1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus : 1;
	const defEvasion = calcEvasionRate(def.effectiveSpdForCalc * (defBuffs.spdUp ? defBuffs.spdUp.rate : 1) * (defBuffs.spdDown ? defBuffs.spdDown.rate : 1), pSpd) + (def.eff.evasionBonus || 0) + (defBuffs.evasion?.turns > 0 ? defBuffs.evasion.rate * 100 : 0) + (def.hasOnmi ? 5 : 0);
	const buffHitBonus = attBuffs.hitBonus?.turns > 0 ? attBuffs.hitBonus.value : 0;
	const dealToDef = (amt) => {
		if (amt <= 0) return;
		if (def.petActive && def.petHp > 0 && Math.random() < .5) {
			const cut = def.petBuffs.reduceTurns > 0 ? 1 - def.petBuffs.reduce : 1;
			const d = Math.max(1, Math.floor(amt * cut));
			def.petHp = Math.max(0, def.petHp - d);
			ctx.logs.push({
				text: `↳ 攻撃は${def.profile.username}のペットに！ ${d}ダメージ（残りHP${def.petHp}）`,
				color: "#ff8844"
			});
			if (def.petHp <= 0) ctx.logs.push({
				text: `💥 ${def.profile.username}のペットは倒れた…`,
				color: "#ff4444"
			});
		} else {
			def.hp -= amt;
			if ((def.eff.evoReflectPct || 0) > 0) {
				const refl = Math.max(1, Math.floor(amt * def.eff.evoReflectPct / 100));
				att.hp -= refl;
				ctx.logs.push({
					text: `🛡 真化効果！ ${def.profile.username}が${refl}を反射！`,
					color: "#88ccff"
				});
			}
		}
	};
	const defReduceMult = (useMagical) => {
		const rankRed = calcDefReduction(useMagical ? def.eff.mdef : def.eff.def);
		const dr = defBuffs.dmgReduce?.turns > 0 ? defBuffs.dmgReduce.rate : 1;
		return (1 - rankRed) * dr * evoTakenMult(def.eff, !useMagical);
	};
	const peekIdx = attBuffs.berserk?.turns > 0 && attBuffs.berserk.lockedSkill ? att.expandedSkillSet.findIndex((ss) => ss.skills?.name === attBuffs.berserk.lockedSkill) : att.skillIndex % (att.expandedSkillSet.length || 1);
	const nextSkill = att.expandedSkillSet.length > 0 ? att.expandedSkillSet[Math.max(0, peekIdx)]?.skills : null;
	const nextSkillName = nextSkill?.name || null;
	let mpLack = false;
	if (nextSkill) {
		let peekMpCost = Math.floor((att.isArtifact ? (nextSkill.mp_cost || 0) * 2 : nextSkill.mp_cost || 0) * att.passiveMpCostMult);
		if (nextSkill.name === "マナボルト") peekMpCost = Math.max(1, Math.floor(att.mp * .1));
		mpLack = att.mp < peekMpCost;
		if (mpLack) logs.push({
			text: `💧 ${profile.username}はMPが足りなくてスキルが使えない！`,
			color: "#6699ff"
		});
	}
	const isSureHit = !mpLack && nextSkillName === "絶影狙撃";
	const isSelfSkill = !mpLack && nextSkill && (nextSkill.type === "強化" || nextSkill.type === "回復");
	const isMultiHitSkill = !mpLack && nextSkill && MULTI_HIT_SKILLS.has(nextSkill.name);
	const skillExtraHit = nextSkillName === "連装銃撃" && profile.class === "魔銃士" && att.rtCur >= 2 ? 10 : 0;
	const baseDefEvasion = Math.max(0, defEvasion - att.playerHitBonus - buffHitBonus - skillExtraHit);
	const effectiveDefEvasion = isSureHit || isSelfSkill || isMultiHitSkill ? 0 : baseDefEvasion;
	if (effectiveDefEvasion > 0 && Math.random() * 100 < effectiveDefEvasion) {
		logs.push({
			text: `${prefix}${nextSkillName && !mpLack ? `${nextSkillName}！` : "攻撃！"} しかし${enemyName}に回避された！`,
			color: "#446688"
		});
		evoOnEvade(def.eff, defBuffs, logs);
		if (nextSkill && !mpLack) {
			const resPeek = executeSkill(nextSkill, effBuff, profile, enemyObj, defBuffs, attBuffs, att.isArtifact, att.prevSkillName);
			if (resPeek.followup && resPeek.followup.dmg > 0) {
				const fScale = ratioAtk / (ratioAtk + Math.max(1, Math.floor((def.eff.def || 0) * eDefRate)));
				const fCrit = Math.random() * 100 < critRate;
				const fCritMult = fCrit ? 1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus : 1;
				const dr = defBuffs.dmgReduce?.turns > 0 ? defBuffs.dmgReduce.rate : 1;
				let fDmg = Math.floor(resPeek.followup.dmg * fScale * fCritMult * att.passiveDmgMult * dr * (1 - calcDefReduction(def.eff.def)) * PVP.dmgMult * ctx.atkDmgMult * (.9 + Math.random() * .2));
				fDmg = Math.max(1, fDmg);
				dealToDef(fDmg);
				logs.push({
					text: `↳ 追撃！${resPeek.followup.label ? `（${resPeek.followup.label}）` : ""} ${enemyName}に${fDmg}ダメージ！${fCrit ? " 💥クリティカル！" : ""}`,
					color: fCrit ? "#ffaa00" : "#ffaa66"
				});
			}
		}
		if (att.expandedSkillSet.length > 0) att.skillIndex++;
		return;
	}
	if (attBuffs.berserk?.turns > 0 && attBuffs.berserk.lockedSkill) {
		const lockedIdx = att.expandedSkillSet.findIndex((ss) => ss.skills?.name === attBuffs.berserk.lockedSkill);
		if (lockedIdx >= 0) att.skillIndex = lockedIdx;
	}
	let skillUsed = false;
	if (att.expandedSkillSet.length > 0) {
		const cs = att.expandedSkillSet[att.skillIndex % att.expandedSkillSet.length];
		let mpCost = Math.floor((att.isArtifact ? (cs?.skills?.mp_cost || 0) * 2 : cs?.skills?.mp_cost || 0) * att.passiveMpCostMult);
		if (cs?.skills?.name === "マナボルト") mpCost = Math.max(1, Math.floor(att.mp * .1));
		if (cs?.skills?.name === "天墜竜閃" && attBuffs.tenkaiCharge?.turns > 0) mpCost = 0;
		if (cs?.skills && BREEDER_PET_SKILLS.has(cs.skills.name)) if (att.petActive && att.petHp > 0 && att.mp >= mpCost) {
			att.mp -= mpCost;
			const nm = cs.skills.name;
			if (nm === "攻撃して！") {
				if (petAttackPvp(att, def, att.rtCur >= 2 ? 3.5 : 3, "攻撃して！", logs)) return;
			} else if (nm === "やっちゃえ！") {
				if (petAttackPvp(att, def, att.rtCur >= 5 ? 6 : 5, "やっちゃえ！", logs)) return;
			} else if (nm === "一緒に頑張ろう！") {
				const t = att.rtCur >= 3 ? 6 : 3;
				attBuffs.breederDmgUp = {
					turns: t,
					rate: 1.5
				};
				logs.push({
					text: `${prefix}一緒に頑張ろう！ ${t}ターンの間、自分とペットの与ダメージ+50%！`,
					color: "#ffcc66"
				});
			} else if (nm === "休憩しよう！") {
				const ph = Math.floor(att.eff.hp_max * .2);
				att.hp = Math.min(att.eff.hp_max, att.hp + ph);
				const pph = Math.floor(att.petMaxHp * .2);
				att.petHp = Math.min(att.petMaxHp, att.petHp + pph);
				let cutTxt = "";
				if (att.rtCur >= 4) {
					attBuffs.dmgReduce = {
						turns: 1,
						rate: .7
					};
					att.petBuffs.reduce = .3;
					att.petBuffs.reduceTurns = 1;
					cutTxt = " 1ターン被ダメ30%カット！";
				}
				logs.push({
					text: `${prefix}休憩しよう！ 自分のHP+${ph}・ペットのHP+${pph}！${cutTxt}`,
					color: "#66ddaa"
				});
			}
			att.skillIndex++;
			return;
		} else logs.push({
			text: `${prefix}${cs.skills.name}！ しかしペットがいない…通常攻撃になった！`,
			color: "#888888"
		});
		if (cs && cs.skills && !BREEDER_PET_SKILLS.has(cs.skills.name) && att.mp >= mpCost) {
			att.mp -= mpCost;
			att.expandedSkillSet.some((ss) => ss.skills?.name === "元素共鳴");
			const gensoMult = 1;
			const seimitsuMult = 1;
			att.prevSkillName = cs.skills.name;
			const res = executeSkill(cs.skills, {
				...effBuff,
				lastMpCost: mpCost
			}, profile, enemyObj, defBuffs, attBuffs, att.isArtifact, att.prevSkillName);
			const finalCrit = res.dmg > 0 && (isCrit || res.bonusCritRate > 0 && Math.random() * 100 < critRate + res.bonusCritRate);
			const finalCritMult = finalCrit ? 1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus : 1;
			const tosoMult = att.hasTosoHonno && att.hp <= eff.hp_max * .5 ? att.pe("体術師") ? 1.25 : 1.1 : 1;
			const sType = cs.skills?.type;
			let defScale = 1;
			let useMagicalRank = sType === "魔法攻撃";
			if (res.dmg > 0) {
				const buffPen = attBuffs.mukyoPen?.turns > 0 ? attBuffs.mukyoPen.rate : 0;
				const spMdefPen = attBuffs.spiritMdefPen?.turns > 0 ? attBuffs.spiritMdefPen.rate : 0;
				const adjED = Math.max(1, Math.floor((def.eff.def || 0) * eDefRate * (1 - Math.min(.8, (res.defPen || 0) + buffPen))));
				const adjEMD = Math.max(1, Math.floor((def.eff.mdef || 0) * eMdefRate * (1 - Math.min(.8, (res.mdefPen || 0) + spMdefPen))));
				if (res.physScaleMatk) {
					defScale = ratioMatk / (ratioMatk + adjED);
					useMagicalRank = false;
				} else if (cs.skills?.name === "サイコブラスト" || res.useMinDef) {
					defScale = ratioMatk / (ratioMatk + Math.min(adjED, adjEMD));
					useMagicalRank = adjEMD <= adjED;
				} else if (sType === "物理攻撃") {
					defScale = ratioAtk / (ratioAtk + adjED);
					useMagicalRank = false;
				} else if (sType === "魔法攻撃") {
					defScale = ratioMatk / (ratioMatk + adjEMD);
					useMagicalRank = true;
				}
			}
			const allinDebuffOutMult = attBuffs.allinDebuff?.turns > 0 ? .7 : 1;
			const reduceMult = defReduceMult(useMagicalRank);
			const isPhysSkill = cs.skills?.type === "物理攻撃";
			const emMult = emblemDmgMult(eff, isPhysSkill);
			const isMulti = Array.isArray(res.hitDmgs) && res.hitDmgs.length > 0 && res.dmg > 0;
			let finalDmg, resLog, multiCritAny = false;
			if (isMulti) {
				const hitMult = defScale * att.passiveDmgMult * gensoMult * tosoMult * seimitsuMult * allinDebuffOutMult * reduceMult * PVP.dmgMult * ctx.atkDmgMult * emMult;
				const parts = [];
				finalDmg = 0;
				for (const hd of res.hitDmgs) {
					if (baseDefEvasion > 0 && Math.random() * 100 < baseDefEvasion) {
						parts.push("回避された！");
						continue;
					}
					const hCrit = Math.random() * 100 < critRate + (res.bonusCritRate || 0);
					const hMult = hCrit ? 1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus : 1;
					const hDmg = Math.max(1, Math.floor(hd * hitMult * hMult * (.9 + Math.random() * .2)));
					if (hCrit) multiCritAny = true;
					finalDmg += hDmg;
					parts.push(`${hDmg}ダメージ！${hCrit ? "💥" : ""}`);
				}
				if (minDmg > 0) finalDmg = Math.max(finalDmg, minDmg);
				resLog = `${res.log.split("！")[0]}！ ${enemyName}に ${parts.join(" ")}`;
			} else {
				finalDmg = Math.floor(res.dmg * defScale * finalCritMult * att.passiveDmgMult * gensoMult * tosoMult * seimitsuMult * allinDebuffOutMult * reduceMult * PVP.dmgMult * ctx.atkDmgMult * emMult * (.9 + Math.random() * .2));
				if (res.dmg > 0 && minDmg > 0) finalDmg = Math.max(finalDmg, minDmg);
				resLog = res.dmg > 0 ? res.log.replace(String(res.dmg), String(finalDmg)) : res.log;
			}
			if (res.dmg > 0) att.prevDmgSkillName = cs.skills?.name;
			if (res.selfDmg > 0) att.hp = Math.max(0, att.hp - res.selfDmg);
			dealToDef(finalDmg);
			{
				const emDrain = emblemDrainAmount(eff, finalDmg, isPhysSkill);
				if (emDrain > 0 && !(attBuffs.healSeal?.turns > 0)) {
					att.hp = Math.min(eff.hp_max, att.hp + emDrain);
					logs.push({
						text: `💠 紋章の吸収！ HPが${emDrain}回復！`,
						color: "#66ddff"
					});
				}
			}
			evoOnHit(eff, finalDmg, res.newEnemyBuffs, enemyName, logs);
			if (finalDmg > 0 && att.equippedWeaponItem?.bonus_effect === "hit_heal_down_10_2t" && !(res.newEnemyBuffs.healDown?.turns > 0)) {
				res.newEnemyBuffs.healDown = {
					turns: 2,
					rate: .7
				};
				logs.push({
					text: `🗡 ${att.equippedWeaponItem?.weapons?.name || "武器"}の効果！ ${enemyName}の回復力が2ターンの間-30%！`,
					color: "#ff8844"
				});
			}
			if (finalDmg > 0 && att.equippedWeaponItem?.bonus_effect === "hit_spd_down_5") {
				const curSd = res.newEnemyBuffs.spdDown;
				const amzSt = Math.min(4, (curSd?.turns > 0 && curSd.amazaneStacks || 0) + 1);
				const amzRate = Math.round((1 - .05 * amzSt) * 100) / 100;
				if (!(curSd?.turns > 0) || curSd.amazaneStacks > 0 || amzRate < curSd.rate) res.newEnemyBuffs.spdDown = {
					turns: 2,
					rate: amzRate,
					amazaneStacks: amzSt
				};
			}
			if (isExtra && finalDmg > 0 && (eff?.extraParaChance || 0) > 0 && !(res.newEnemyBuffs.paralysis?.turns > 0) && Math.random() * 100 < eff.extraParaChance) {
				res.newEnemyBuffs.paralysis = {
					turns: 3,
					skipRate: .25,
					spdRate: .8
				};
				logs.push({
					text: `⚡ 蒼雷の短刃の追撃！ ${enemyName}を麻痺させた！`,
					color: "#ffe066"
				});
			}
			const healUpMult = attBuffs.healUp?.turns > 0 ? attBuffs.healUp.rate : 1;
			const healAmt = attBuffs.healSeal?.turns > 0 ? 0 : Math.floor(res.heal * att.passiveHealMult * PVP.healMult * ctx.healMult * healUpMult);
			att.hp = Math.min(eff.hp_max, att.hp + healAmt);
			if (att.passiveHealReflect && healAmt > 0) {
				const reflectDmg = Math.floor(healAmt * .5);
				dealToDef(reflectDmg);
				logs.push({
					text: `✨ 神聖加護の反射！ ${enemyName}に${reflectDmg}ダメージ！`,
					color: "#ffdd44"
				});
			}
			if (attBuffs.spellBladeSealed?.turns > 0) {
				const blocked = [
					"atkUp",
					"matkUp",
					"spdUp",
					"dmgReduce",
					"regenHeal",
					"hitBonus",
					"evasion",
					"bloodRage",
					"statusImmune",
					"holyField",
					"holyAwakening",
					"flashCombo",
					"spellBladeExhaust"
				];
				const had = blocked.some((k) => res.newPlayerBuffs[k] !== attBuffs[k] && res.newPlayerBuffs[k] !== void 0);
				for (const k of blocked) if (res.newPlayerBuffs[k] !== attBuffs[k]) res.newPlayerBuffs[k] = attBuffs[k];
				if (had) logs.push({
					text: `⚔ 魔剣開放の反動中！ バフが効かない！`,
					color: "#ff4444"
				});
			}
			if (attBuffs.allinDebuff?.turns > 0) {
				const blocked = [
					"atkUp",
					"matkUp",
					"spdUp",
					"dmgReduce",
					"regenHeal",
					"hitBonus",
					"evasion",
					"bloodRage",
					"statusImmune"
				];
				const had = blocked.some((k) => res.newPlayerBuffs[k] !== attBuffs[k] && res.newPlayerBuffs[k] !== void 0);
				for (const k of blocked) if (res.newPlayerBuffs[k] !== attBuffs[k]) res.newPlayerBuffs[k] = attBuffs[k];
				if (had) logs.push({
					text: `💸 オールインの反動中！ バフが効かない！`,
					color: "#ff4444"
				});
			}
			att.buffs = res.newPlayerBuffs;
			def.buffs = res.newEnemyBuffs;
			consumeAilmentShield(defBuffs, def.buffs, logs);
			emblemResistNewAilments(def.eff, defBuffs, def.buffs, logs);
			const critInsert = finalCrit && !isMulti ? "💥クリティカル！ " : "";
			const dmgIdx = resLog.indexOf(enemyName + "に");
			const logWithCrit = critInsert ? dmgIdx >= 0 ? resLog.slice(0, dmgIdx) + critInsert + resLog.slice(dmgIdx) : resLog + " " + critInsert : resLog;
			logs.push({
				text: `${prefix}${logWithCrit}`,
				color: finalCrit && !isMulti || multiCritAny ? "#ffff00" : "#88ccff"
			});
			if (res.followup && res.followup.dmg > 0) {
				const fCrit = Math.random() * 100 < critRate + (res.bonusCritRate || 0);
				const fCritMult = fCrit ? 1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus : 1;
				let fDmg = Math.floor(res.followup.dmg * defScale * fCritMult * att.passiveDmgMult * tosoMult * allinDebuffOutMult * reduceMult * PVP.dmgMult * ctx.atkDmgMult * emMult * (.9 + Math.random() * .2));
				fDmg = Math.max(1, fDmg);
				dealToDef(fDmg);
				logs.push({
					text: `↳ 追撃！${res.followup.label ? `（${res.followup.label}）` : ""} ${enemyName}に${fDmg}ダメージ！${fCrit ? " 💥クリティカル！" : ""}`,
					color: fCrit ? "#ffaa00" : "#ffaa66"
				});
			}
			if (att.buffs.bloodRage?.turns > 0 && finalDmg > 0 && !(att.buffs.healSeal?.turns > 0)) {
				const rageCure = Math.min(Math.floor(finalDmg * att.buffs.bloodRage.healRate * PVP.healMult * ctx.healMult), Math.floor(eff.hp_max * .2));
				att.hp = Math.min(eff.hp_max, att.hp + rageCure);
				logs.push({
					text: `🩸 血の狂気で${rageCure}回復！`,
					color: "#ff4444"
				});
			}
			if (att.buffs.holyAwakening?.turns > 0 && finalDmg > 0) {
				const holyBonusDmg = Math.floor((pDef * att.buffs.holyAwakening.defMult + pMdef * att.buffs.holyAwakening.defMult) * PVP.dmgMult * ctx.atkDmgMult);
				dealToDef(holyBonusDmg);
				logs.push({
					text: `✨ 神聖覚醒の追撃！ ${enemyName}に${holyBonusDmg}ダメージ！`,
					color: "#ffeeaa"
				});
			}
			skillUsed = true;
			att.skillIndex++;
		}
	}
	if (!skillUsed) {
		const baseAtk = att.isMagical ? effBuff.matk : effBuff.atk;
		const ratioBaseAtk = baseAtk * PVP.ratioAtkMult;
		const eDefVal = att.isMagical ? Math.max(1, Math.floor((def.eff.mdef || 0) * eMdefRate)) : Math.max(1, Math.floor(def.eff.def * eDefRate));
		const baseDmg = Math.max(1, Math.floor(baseAtk * ratioBaseAtk / Math.max(1, ratioBaseAtk + eDefVal)) + Math.floor(Math.random() * 4));
		const reduceMult = defReduceMult(att.isMagical);
		const breederDmgMult = attBuffs.breederDmgUp?.turns > 0 ? attBuffs.breederDmgUp.rate : 1;
		let finalDmg = Math.floor(baseDmg * .7 * critMult * (att.isArtifact ? 1.3 : 1) * att.passiveDmgMult * reduceMult * breederDmgMult * PVP.dmgMult * ctx.atkDmgMult * emblemDmgMult(eff, !att.isMagical) * (.9 + Math.random() * .2));
		if (minDmg > 0) finalDmg = Math.max(finalDmg, minDmg);
		dealToDef(finalDmg);
		{
			const emDrain = emblemDrainAmount(eff, finalDmg, !att.isMagical);
			if (emDrain > 0 && !(attBuffs.healSeal?.turns > 0)) {
				att.hp = Math.min(eff.hp_max, att.hp + emDrain);
				logs.push({
					text: `💠 紋章の吸収！ HPが${emDrain}回復！`,
					color: "#66ddff"
				});
			}
		}
		const prevDefBuffsN = { ...defBuffs };
		evoOnHit(eff, finalDmg, defBuffs, enemyName, logs);
		consumeAilmentShield(prevDefBuffsN, defBuffs, logs);
		emblemResistNewAilments(def.eff, prevDefBuffsN, defBuffs, logs);
		const critText = isCrit ? "💥クリティカル！ " : "";
		logs.push({
			text: `${prefix}${critText}攻撃！ ${enemyName}に${finalDmg}ダメージ！`,
			color: "#ffcc00"
		});
		if (att.buffs.bloodRage?.turns > 0 && finalDmg > 0 && !(att.buffs.healSeal?.turns > 0)) {
			const rageCure = Math.min(Math.floor(finalDmg * att.buffs.bloodRage.healRate * PVP.healMult * ctx.healMult), Math.floor(eff.hp_max * .2));
			att.hp = Math.min(eff.hp_max, att.hp + rageCure);
			logs.push({
				text: `🩸 血の狂気で${rageCure}回復！`,
				color: "#ff4444"
			});
		}
		if (attBuffs.spiritCombo) attBuffs.spiritCombo = void 0;
		if (attBuffs.kinjutsuLock) attBuffs.kinjutsuLock = void 0;
		if (att.expandedSkillSet.length > 0) att.skillIndex++;
	}
}
function petAttackPvp(side, opp, mult, label, logs) {
	if (!side.petActive || side.petHp <= 0) return false;
	const name = side.profile.username;
	const isSpec = side.petAtkType === "spec";
	const edr = (opp.buffs.defDown?.rate || 1) * (opp.buffs.defUp?.rate || 1);
	const emr = (opp.buffs.mdefDown?.rate || 1) * (opp.buffs.mdefUp?.rate || 1);
	const adjDef = Math.max(1, Math.floor(isSpec ? (opp.eff.mdef || 0) * emr : (opp.eff.def || 0) * edr));
	const base = side.petAtk * mult;
	const dmgUp = side.buffs.breederDmgUp?.turns > 0 ? side.buffs.breederDmgUp.rate : 1;
	const dmg = Math.max(1, Math.floor(base * (base / (base + adjDef)) * dmgUp * PVP.dmgMult));
	opp.hp -= dmg;
	let extra = "";
	if (side.rtCur >= 1) {
		if (side.petSpecies === "flame" && Math.random() * 100 < 30 && !emblemBlocksAilment(opp.eff, "bleed", null)) {
			const b = opp.buffs.bleed;
			opp.buffs.bleed = {
				stacks: Math.min(5, (b?.stacks || 0) + 1),
				lastTurn: 0
			};
			extra = " 出血！";
		} else if (side.petSpecies === "aqua" && Math.random() * 100 < 40) {
			opp.buffs.spdDown = {
				turns: 3,
				rate: .7
			};
			extra = " 素早さ低下！";
		} else if (side.petSpecies === "leaf") {
			const sr = opp.buffs.stunResist ?? 1;
			if (Math.random() * 100 < 30 * sr && !emblemBlocksAilment(opp.eff, "stun", null)) {
				opp.buffs.stun = { turns: 1 };
				opp.buffs.stunResist = sr * .5;
				extra = " スタン！";
			}
		}
	}
	logs.push({
		text: `🐾 ${name}のペットの${label}！ ${opp.profile.username}に${dmg}ダメージ！${extra}`,
		color: "#ffaa44"
	});
	return opp.hp <= 0;
}
function applyTurnStart(side, opp, ctx) {
	const logs = ctx.logs;
	const name = side.profile.username;
	const maxHp = side.eff.hp_max;
	const b = side.buffs;
	if (b.severePoisoin?.turns > 0) {
		const d = Math.floor(maxHp * .05 * ctx.dotMult * emblemDotMult(opp.eff, "poison"));
		side.hp = Math.max(0, side.hp - d);
		logs.push({
			text: `🤢 猛毒ダメージ！ ${name}に${d}ダメージ！`,
			color: "#aa44ff"
		});
		if (side.hp <= 0) return true;
	}
	if (b.burn?.turns > 0) {
		const d = Math.floor(maxHp * .02 * ctx.dotMult * emblemDotMult(opp.eff, "burn"));
		side.hp = Math.max(0, side.hp - d);
		logs.push({
			text: `🔥 やけどダメージ！ ${name}に${d}ダメージ！`,
			color: "#ff6622"
		});
		if (side.hp <= 0) return true;
	}
	if (b.poison?.turns > 0) {
		const d = Math.floor(maxHp * b.poison.dmgRate * ctx.dotMult * emblemDotMult(opp.eff, "poison"));
		side.hp = Math.max(0, side.hp - d);
		logs.push({
			text: `☠ 毒ダメージ！ ${name}に${d}ダメージ！`,
			color: "#44ff44"
		});
		if (side.hp <= 0) return true;
	}
	if (b.curseDmg?.turns > 0) {
		const cd = Math.floor(b.curseDmg.dmg * ctx.dotMult);
		side.hp = Math.max(0, side.hp - cd);
		logs.push({
			text: `💀 呪縛ダメージ！ ${name}に${cd}ダメージ！`,
			color: "#cc44ff"
		});
		if (side.hp <= 0) return true;
	}
	if (b.bleed) {
		const d = Math.floor(side.hp * .01 * b.bleed.stacks * ctx.dotMult * emblemDotMult(opp.eff, "bleed"));
		side.hp = Math.max(0, side.hp - d);
		logs.push({
			text: `🩸 出血ダメージ！ ${name}に${d}ダメージ（${b.bleed.stacks}スタック）！`,
			color: "#ff4466"
		});
		if (side.hp <= 0) return true;
		b.bleed.lastTurn = (b.bleed.lastTurn || 0) + 1;
		if (b.bleed.lastTurn >= 3) delete b.bleed;
	}
	if (b.skeletonDmg?.turns > 0) {
		const d = Math.floor(b.skeletonDmg.dmg * PVP.dmgMult);
		opp.hp -= d;
		logs.push({
			text: `💀 ${name}の骸骨の持続ダメージ！ ${opp.profile.username}に${d}ダメージ！`,
			color: "#cc44ff"
		});
		if (opp.hp <= 0) return true;
	}
	if (side.hasShikigami) {
		const mult = side.rtCur >= 1 ? .8 : .5;
		const eMdefR = (opp.buffs.mdefDown ? opp.buffs.mdefDown.rate : 1) * (opp.buffs.mdefUp ? opp.buffs.mdefUp.rate : 1);
		const matk = side.eff.matk;
		const adjEMD = Math.max(1, Math.floor((opp.eff.mdef || 0) * eMdefR));
		const d = Math.max(1, Math.floor(matk * mult * (matk / (matk + adjEMD)) * PVP.dmgMult));
		opp.hp -= d;
		logs.push({
			text: `👹 ${name}の式神の攻撃！ ${opp.profile.username}に${d}ダメージ！`,
			color: "#cc88ff"
		});
		if (opp.hp <= 0) return true;
	}
	if (side.petActive && side.petHp > 0) {
		if (petAttackPvp(side, opp, 1, "こうげき", logs)) return true;
	}
	const sealed = b.healSeal?.turns > 0;
	if (sealed) logs.push({
		text: `🚫 ${name}は回復封じ中！ 回復効果が無効化された！`,
		color: "#ff4488"
	});
	if (b.regen?.turns > 0) {
		const amt = Math.floor(maxHp * b.regen.rate * PVP.healMult * ctx.healMult);
		side.hp = Math.min(maxHp, side.hp + amt);
		logs.push({
			text: `💚 ${name}のリジェネ！ HPが${amt}回復した！`,
			color: "#44ff88"
		});
	}
	if (!sealed && b.regenHeal?.turns > 0) {
		const amt = Math.floor(b.regenHeal.amount * side.passiveHealMult * PVP.healMult * ctx.healMult * (b.healUp?.turns > 0 ? b.healUp.rate : 1));
		side.hp = Math.min(maxHp, side.hp + amt);
		logs.push({
			text: `💚 ${name}の回復効果でHPが${amt}回復した！`,
			color: "#44ff88"
		});
	}
	if (b.regenMp?.turns > 0) {
		const maxMp = side.eff.mp_max;
		const amt = Math.floor(maxMp * b.regenMp.rate);
		if (amt > 0 && side.mp < maxMp) {
			side.mp = Math.min(maxMp, side.mp + amt);
			logs.push({
				text: `🔵 ${name}の魔力供給でMPが${amt}回復した！`,
				color: "#4488ff"
			});
		}
	}
	if (!sealed && b.delayHeal && ctx.turn === b.delayHeal.triggerTurn) {
		const amt = Math.floor(b.delayHeal.amount * PVP.healMult * ctx.healMult);
		side.hp = Math.min(maxHp, side.hp + amt);
		logs.push({
			text: `💚 ${name}の装備効果でHPが${amt}回復した！`,
			color: "#44ff88"
		});
	}
	return false;
}
function checkSkip(side, ctx) {
	const b = side.buffs;
	const name = side.profile.username;
	if (b.stun?.turns > 0) {
		ctx.logs.push({
			text: `${ctx.turn}ターン目: ${name}はスタンして行動できない！`,
			color: "#ffaa00"
		});
		delete b.stun;
		return true;
	}
	if (b.paralysis?.turns > 0 && Math.random() < b.paralysis.skipRate) {
		ctx.logs.push({
			text: `${ctx.turn}ターン目: ${name}は麻痺で行動不能！`,
			color: "#ffaa00"
		});
		b.paralysis.skipRate *= .5;
		return true;
	}
	return false;
}
function takeTurn(att, def, ctx) {
	if (checkSkip(att, ctx)) return false;
	doAttack(att, def, false, ctx);
	if (def.hp <= 0) return true;
	if (att.hasSpiritResonance && att.buffs.spiritCombo?.tripled) {
		att.buffs.guaranteedExtra = true;
		att.buffs.spiritCombo = {
			...att.buffs.spiritCombo,
			tripled: false
		};
		ctx.logs.push({
			text: `🌟 ${att.profile.username} の精霊共鳴！ 追加行動を得る！`,
			color: "#ffdd66"
		});
	}
	const spiritExtra = !!att.buffs.guaranteedExtra;
	if (att.buffs.guaranteedExtra) att.buffs.guaranteedExtra = false;
	const extraRate = calcExtraActionRate(att.effectiveSpdForCalc * (att.buffs.spdUp ? att.buffs.spdUp.rate : 1), def.effectiveSpdForCalc * (def.buffs.spdUp ? def.buffs.spdUp.rate : 1));
	if (spiritExtra || extraRate > 0 && Math.random() * 100 < extraRate) {
		doAttack(att, def, true, ctx);
		if (def.hp <= 0) return true;
	}
	return false;
}
function endTurnBuffs(side, ctx, hpBeforeTurn) {
	const b = side.buffs;
	const logs = ctx.logs;
	const berserkWasActive = b.berserk?.turns > 0;
	Object.keys(b).forEach((k) => {
		if (b[k]?.turns > 0) b[k].turns--;
	});
	if (side.petBuffs?.reduceTurns > 0) side.petBuffs.reduceTurns--;
	if (berserkWasActive && b.berserk?.turns === 0 && side.expandedSkillSet.length > 0) {
		const lockedIdx = side.expandedSkillSet.findIndex((ss) => ss.skills?.name === b.berserk.lockedSkill);
		if (lockedIdx >= 0) side.skillIndex = lockedIdx + 1;
	}
	if (b.spellBladeExhaust?.turns === 0) {
		const sealT = b.spellBladeExhaust.sealTurns || 4;
		delete b.spellBladeExhaust;
		b.spellBladeSealed = { turns: sealT };
		logs.push({
			text: `⚔ ${side.profile.username}の魔剣開放の反動！ ${sealT}ターンの間バフ不可状態になった！`,
			color: "#ff4444"
		});
	}
	if (b.allinActive?.turns === 0) {
		const reactT = b.allinActive.reactTurns || 2;
		delete b.allinActive;
		delete b.atkUp;
		delete b.matkUp;
		delete b.spdUp;
		delete b.dmgReduce;
		b.allinDebuff = {
			turns: reactT,
			rate: .7
		};
		logs.push({
			text: `💸 ${side.profile.username}のオールインの効果が切れた！ ${reactT}ターンの間全ステータスが低下し、バフが使えない！`,
			color: "#ff4444"
		});
	}
	Object.keys(b).forEach((k) => {
		if (b[k]?.turns === 0) delete b[k];
	});
	if (side.ondmgSpdUp > 1 && side.hp < hpBeforeTurn && !(b.spdUp?.turns > 0 && b.spdUp.rate >= side.ondmgSpdUp)) {
		b.spdUp = {
			turns: 2,
			rate: side.ondmgSpdUp
		};
		logs.push({
			text: `⚙ ${side.profile.username}の雷鋼の機神鎧が起動！ 2ターンの間 素早さ+${Math.round((side.ondmgSpdUp - 1) * 100)}%！`,
			color: "#66ccff"
		});
	}
	if (ctx.turn % 5 === 0 && !(b.ailmentShield?.charges > 0) && side.equipment?.some((e) => e.equipped && e.bonus_effect === "battle_start_ailment_shield")) {
		b.ailmentShield = { charges: 1 };
		logs.push({
			text: `🛡 ${side.profile.username}の哭雨の羽衣の加護！ 状態異常を1回無効化するバフを獲得！`,
			color: "#66ccff"
		});
	}
}
function simulatePvpBattle(inputA, inputB, opts = {}) {
	const { hpBonus = 0, turnCap = PVP.turnCap } = opts;
	const logs = [];
	const A = buildSide(inputA, "A", hpBonus);
	const B = buildSide(inputB, "B", hpBonus);
	if (opts.startHpA != null) A.hp = Math.min(A.eff.hp_max, Math.max(0, opts.startHpA));
	if (opts.startMpA != null) A.mp = Math.min(A.eff.mp_max, Math.max(0, opts.startMpA));
	if (opts.startHpB != null) B.hp = Math.min(B.eff.hp_max, Math.max(0, opts.startHpB));
	if (opts.startMpB != null) B.mp = Math.min(B.eff.mp_max, Math.max(0, opts.startMpB));
	logs.push({
		text: `⚔ 対人戦開始！ ${A.profile.username} vs ${B.profile.username}`,
		color: "#ffcc66"
	});
	logs.push({
		text: `（与ダメージは防御力で大きく軽減／回復は通常どおり／素早さによる補正は無し）`,
		color: "#88aacc"
	});
	A.buffs = applyEquipmentEffects(A.equipment, {
		...A.profile,
		hp_max: A.eff.hp_max
	}, A.buffs, logs);
	B.buffs = applyEquipmentEffects(B.equipment, {
		...B.profile,
		hp_max: B.eff.hp_max
	}, B.buffs, logs);
	const ctx = {
		logs,
		turn: 1,
		atkDmgMult: opts.atkDmgMult ?? 1,
		dotMult: opts.dotMult ?? 1,
		healMult: opts.healMult ?? 1,
		minDmgPct: opts.minDmgPct ?? 0
	};
	while (A.hp > 0 && B.hp > 0 && ctx.turn <= turnCap) {
		const aSpd = A.effectiveSpdForCalc * (A.buffs.spdUp ? A.buffs.spdUp.rate : 1);
		const bSpd = B.effectiveSpdForCalc * (B.buffs.spdUp ? B.buffs.spdUp.rate : 1);
		const order = aSpd > bSpd ? [A, B] : aSpd < bSpd ? [B, A] : Math.random() < .5 ? [A, B] : [B, A];
		const aHpBefore = A.hp, bHpBefore = B.hp;
		let dead = false;
		for (const s of order) if (applyTurnStart(s, s === A ? B : A, ctx)) {
			dead = true;
			break;
		}
		if (dead || A.hp <= 0 || B.hp <= 0) break;
		const first = order[0], second = order[1];
		if (takeTurn(first, second, ctx) || second.hp <= 0) break;
		if (takeTurn(second, first, ctx) || first.hp <= 0) break;
		endTurnBuffs(A, ctx, aHpBefore);
		endTurnBuffs(B, ctx, bHpBefore);
		logs.push({
			type: "hp",
			turn: ctx.turn,
			playerHp: Math.max(0, A.hp),
			playerMax: A.eff.hp_max,
			playerName: A.profile.username,
			enemyHp: Math.max(0, B.hp),
			enemyMax: B.eff.hp_max,
			enemyName: B.profile.username,
			playerMp: Math.max(0, A.mp),
			playerMpMax: A.eff.mp_max,
			enemyMp: Math.max(0, B.mp),
			enemyMpMax: B.eff.mp_max,
			playerStatus: extractStatuses(A.buffs),
			enemyStatus: extractStatuses(B.buffs),
			petHp: A.petActive ? Math.max(0, A.petHp) : null,
			petMax: A.petActive ? A.petMaxHp : null
		});
		ctx.turn++;
	}
	const aHpPct = Math.max(0, A.hp) / A.eff.hp_max;
	const bHpPct = Math.max(0, B.hp) / B.eff.hp_max;
	let winner;
	if (B.hp <= 0 && A.hp > 0) winner = "A";
	else if (A.hp <= 0 && B.hp > 0) winner = "B";
	else if (A.hp <= 0 && B.hp <= 0) winner = "draw";
	else winner = aHpPct > bHpPct ? "A" : bHpPct > aHpPct ? "B" : "draw";
	const turns = Math.min(ctx.turn, turnCap);
	const ranOut = A.hp > 0 && B.hp > 0;
	if (opts.warMode && ranOut) logs.push({
		text: `⚖ 決着がつかなかった（${turns}ターン）`,
		color: "#cccccc"
	});
	else if (winner === "A") logs.push({
		text: `✦ ${A.profile.username} の勝利！（${turns}ターン）`,
		color: "#ffcc44"
	});
	else if (winner === "B") logs.push({
		text: `✦ ${B.profile.username} の勝利！（${turns}ターン）`,
		color: "#ffcc44"
	});
	else logs.push({
		text: `引き分け…（${turns}ターン）`,
		color: "#aaaaaa"
	});
	return {
		logs,
		winner,
		turns,
		aHpPct,
		bHpPct,
		endHpA: Math.max(0, A.hp),
		endMpA: Math.max(0, A.mp),
		endHpB: Math.max(0, B.hp),
		endMpB: Math.max(0, B.mp)
	};
}
//#endregion
//#region src/lib/pvpLoadout.js
async function loadLoadout(playerId, isSelf) {
	const [{ data: profile }, { data: eq }, { data: prof }, { data: pets }] = await Promise.all([
		supabase.from("profiles").select("*").eq("id", playerId).single(),
		supabase.from("player_equipment").select("*, weapons(*)").eq("player_id", playerId).eq("equipped", true),
		supabase.from("proficiency").select("player_id, equipment_id, prof_lv").eq("player_id", playerId),
		supabase.from("pets").select("owner_id, species, level, evolved, charm_id").eq("owner_id", playerId).eq("is_active", true)
	]);
	if (!profile) throw new Error("プロフィールが見つかりません");
	let petStat = null, petCharm = null;
	const pet = (pets || [])[0];
	if (pet) {
		petStat = petPlayerBonus(pet);
		if (pet.charm_id) {
			const { data: charm } = await supabase.from("player_charms").select("*").eq("id", pet.charm_id).maybeSingle();
			if (charm) petCharm = charmPlayerBonus(charm);
		}
	}
	let titleBonus = null;
	if (profile.ability_title_id) {
		const { data: at } = await supabase.from("titles").select("*").eq("id", profile.ability_title_id).maybeSingle();
		titleBonus = at || null;
	}
	let emblemAlloc = null;
	try {
		const { data: em } = await supabase.from("player_emblem").select("alloc").eq("player_id", playerId).maybeSingle();
		if (em?.alloc && Object.keys(em.alloc).length > 0) emblemAlloc = em.alloc;
	} catch {}
	let skillSets;
	if (isSelf) {
		const { data: ss } = await supabase.from("skill_sets").select("*, skills(*)").eq("player_id", playerId).order("slot_order");
		const all = ss || [];
		const pvp = all.filter((r) => (r.set_type || "sortie") === "pvp");
		skillSets = pvp.some((r) => r.skills?.type !== "パッシブ") ? pvp : all.filter((r) => (r.set_type || "sortie") === "sortie");
	} else {
		const { data: rpc } = await supabase.rpc("pvp_get_skillsets", { p_target: playerId });
		if (rpc?.error) throw new Error(rpc.error);
		skillSets = rpc?.skill_sets || [];
	}
	const profileWithPet = {
		...profile,
		petStat,
		petCharm,
		activePet: pet || null,
		emblemAlloc
	};
	return {
		eff: calcEffectiveStats(profileWithPet, eq || [], prof || [], titleBonus),
		equipment: eq || [],
		skillSets,
		proficiency: prof || [],
		profile: profileWithPet,
		playerItem: null
	};
}
async function loadTotalCandidates(excludeId) {
	let excluded = /* @__PURE__ */ new Set();
	try {
		const { data: exRows } = await supabase.from("profiles").select("id").eq("exclude_from_ranking", true);
		excluded = new Set((exRows || []).map((r) => r.id));
	} catch {}
	const { data } = await supabase.from("profiles").select("id, username, lv, char_lv, class, hp_max, mp_max, atk, def, matk, mdef, spd, avatar_url, retraining, museum_atk, museum_def, museum_matk, museum_mdef, museum_spd, museum_hp, museum_mp, fishing_atk, fishing_def, fishing_matk, fishing_mdef, fishing_spd, fishing_hp, fishing_mp, ability_title_id").order("char_lv", { ascending: false }).limit(200);
	const list = (data || []).filter((p) => !excluded.has(p.id) && p.id !== excludeId);
	const ids = list.map((p) => p.id);
	if (ids.length === 0) return [];
	const [{ data: eqData }, { data: profData }, { data: petData }] = await Promise.all([
		supabase.from("player_equipment").select("*, weapons(*)").in("player_id", ids).eq("equipped", true),
		supabase.from("proficiency").select("player_id, equipment_id, prof_lv").in("player_id", ids),
		supabase.from("pets").select("owner_id, species, level, evolved, charm_id").in("owner_id", ids).eq("is_active", true)
	]);
	const eqs = eqData || [], profs = profData || [];
	const petStatMap = {}, charmMap = {};
	for (const pet of petData || []) petStatMap[pet.owner_id] = petPlayerBonus(pet);
	const charmIds = [...new Set((petData || []).map((p) => p.charm_id).filter(Boolean))];
	if (charmIds.length > 0) {
		const { data: charmRows } = await supabase.from("player_charms").select("*").in("id", charmIds);
		const charmById = {};
		for (const c of charmRows || []) charmById[c.id] = c;
		for (const pet of petData || []) if (pet.charm_id && charmById[pet.charm_id]) charmMap[pet.owner_id] = charmPlayerBonus(charmById[pet.charm_id]);
	}
	const titleMap = {};
	const titleIds = [...new Set(list.map((p) => p.ability_title_id).filter(Boolean))];
	if (titleIds.length > 0) {
		const { data: titlesData } = await supabase.from("titles").select("*").in("id", titleIds);
		for (const t of titlesData || []) titleMap[t.id] = t;
	}
	return list.map((p) => {
		const eq = eqs.filter((e) => e.player_id === p.id);
		const pf = profs.filter((x) => x.player_id === p.id);
		const tb = p.ability_title_id ? titleMap[p.ability_title_id] : null;
		const pProfile = {
			...p,
			petStat: petStatMap[p.id] || null,
			petCharm: charmMap[p.id] || null
		};
		return {
			id: p.id,
			username: p.username,
			char_lv: p.char_lv || p.lv,
			class: p.class,
			avatar_url: p.avatar_url,
			_total: calcEffectiveTotal(pProfile, eq, pf, tb)
		};
	}).sort((a, b) => b._total - a._total);
}
//#endregion
export { loadTotalCandidates as n, simulatePvpBattle as r, loadLoadout as t };
