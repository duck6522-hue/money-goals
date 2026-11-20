// 目標の進捗計算。画面（index.html）とテスト（calc.test.js）の両方から使う。
// 日付はすべて 'YYYY-MM-DD' の文字列、金額は円の整数。
(function (root) {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  const dayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  // a から b まで何日進むか（同じ日なら 0）
  const daysBetween = (a, b) => Math.round((dayDate(b) - dayDate(a)) / 864e5);
  const addDays = (s, n) => { const d = dayDate(s); d.setDate(d.getDate() + n); return dayStr(d); };
  const monthStart = ym => `${ym}-01`;
  const monthEnd = ym => { const [y, m] = ym.split('-').map(Number); return `${ym}-${pad(new Date(y, m, 0).getDate())}`; };
  const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

  // ペースの許容幅（目標額に対する割合）
  const PACE_TOL = 0.05;

  /** 基準日 ref における目標の集計期間 */
  function periodOf(goal, ref) {
    if (goal.period === 'range') return { start: goal.start, end: goal.end };
    const ym = ref.slice(0, 7);
    return { start: monthStart(ym), end: monthEnd(ym) };
  }

  /** 期間内（両端を含む）の記録の合計 */
  function sumIn(entries, goalId, start, end) {
    let s = 0;
    for (const e of entries) if (e.goalId === goalId && e.date >= start && e.date <= end) s += e.amount;
    return s;
  }

  /**
   * 目標の進捗。today は「今日」（ペースや残り日数の基準）。
   * 返り値:
   *  current, target, rate(0..), remain(目標額−現在額),
   *  totalDays, elapsedDays(今日を含む経過日数), remainDays(今日を含む残り日数), elapsedRatio,
   *  phase: 'before' | 'active' | 'ended',
   *  pace: 'ontrack' | 'ahead' | 'behind' | 'before' | 'done' | 'missed',
   *  paceDiff: 現在額 − 目安額（active のとき）,
   *  perDay: 上限＝1日あたり使える額、貯金＝1日あたり必要な額（active のとき。なければ null）
   */
  function progress(goal, entries, today) {
    const { start, end } = periodOf(goal, today);
    const target = goal.amount;
    // 今日より先の日付の記録（予定として入れたもの）は、まだ数えない
    const current = today < start ? 0 : sumIn(entries, goal.id, start, today < end ? today : end);
    const totalDays = daysBetween(start, end) + 1;
    let phase, elapsedDays;
    if (today < start) { phase = 'before'; elapsedDays = 0; }
    else if (today > end) { phase = 'ended'; elapsedDays = totalDays; }
    else { phase = 'active'; elapsedDays = daysBetween(start, today) + 1; }
    const remainDays = totalDays - elapsedDays + (phase === 'active' ? 1 : 0);
    const elapsedRatio = elapsedDays / totalDays;
    const rate = target > 0 ? current / target : 0;
    const remain = target - current;
    const isLimit = goal.type === 'limit';

    let pace, paceDiff = 0;
    if (phase === 'before') pace = 'before';
    else if (phase === 'ended') pace = (isLimit ? current <= target : current >= target) ? 'done' : 'missed';
    else {
      const expected = target * elapsedRatio;
      paceDiff = current - expected;
      if (!isLimit && current >= target) pace = 'done';
      else if (Math.abs(paceDiff) <= target * PACE_TOL) pace = 'ontrack';
      else if (isLimit) pace = paceDiff < 0 ? 'ahead' : 'behind';
      else pace = paceDiff > 0 ? 'ahead' : 'behind';
    }

    let perDay = null;
    if (phase === 'active' && remainDays > 0) perDay = Math.max(0, remain) / remainDays;
    else if (phase === 'before' && !isLimit) perDay = Math.max(0, remain) / totalDays;

    return { start, end, current, target, rate, remain, totalDays, elapsedDays, remainDays, elapsedRatio, phase, pace, paceDiff, perDay };
  }

  /** 目標がその月に関係するか（月次は作成月以降、期限付きは期間が重なる月） */
  function activeInMonth(goal, ym) {
    if (goal.period === 'range') return goal.start <= monthEnd(ym) && goal.end >= monthStart(ym);
    const from = (goal.createdAt ? dayStr(new Date(goal.createdAt)) : '0000-01-01').slice(0, 7);
    return ym >= from;
  }

  /**
   * 月次ビューの1行。today より先の月は扱わない前提。
   *  actual: その月の記録の合計、prevActual: 前月の合計、diff: 前月比
   *  月次の目標: target=目標額、rate=actual/target、status='done'|'missed'|'active'
   *  期限付き: cumulative=月末（今月なら今日）までの累計、rate=cumulative/target
   */
  function monthRow(goal, entries, ym, today) {
    const s = monthStart(ym), e = monthEnd(ym), ps = monthStart(addMonths(ym, -1)), pe = monthEnd(addMonths(ym, -1));
    const actual = sumIn(entries, goal.id, s, e);
    const prevActual = sumIn(entries, goal.id, ps, pe);
    const isLimit = goal.type === 'limit';
    const row = { goal, actual, prevActual, diff: actual - prevActual, target: goal.amount };
    if (goal.period === 'monthly') {
      row.rate = goal.amount > 0 ? actual / goal.amount : 0;
      if (today > e) row.status = (isLimit ? actual <= goal.amount : actual >= goal.amount) ? 'done' : 'missed';
      else {
        row.status = 'active';
        row.pace = progress(goal, entries, today).pace;
      }
    } else {
      const upto = today < e ? today : e;
      row.cumulative = sumIn(entries, goal.id, goal.start, upto);
      row.rate = goal.amount > 0 ? row.cumulative / goal.amount : 0;
      const p = progress(goal, entries, upto);
      if (e >= goal.end && today > goal.end) row.status = p.pace; // 'done' | 'missed'
      else { row.status = 'active'; row.pace = p.pace; }
    }
    return row;
  }

  const Calc = { pad, dayStr, dayDate, daysBetween, addDays, monthStart, monthEnd, addMonths, periodOf, sumIn, progress, activeInMonth, monthRow, PACE_TOL };
  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(typeof self !== 'undefined' ? self : this);
