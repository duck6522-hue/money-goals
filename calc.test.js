// node --test で実行する
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./calc.js');

const food = { id: 'f', name: '食費', type: 'limit', amount: 30000, period: 'monthly', createdAt: new Date(2026, 0, 1).getTime() };
const trip = { id: 't', name: '旅行', type: 'save', amount: 100000, period: 'range', start: '2026-11-01', end: '2027-01-29' };
const e = (date, goalId, amount) => ({ id: date + goalId + amount, date, goalId, amount });

test('日付の補助関数', () => {
  assert.equal(C.monthEnd('2026-02'), '2026-02-28');
  assert.equal(C.monthEnd('2028-02'), '2028-02-29');
  assert.equal(C.addMonths('2026-01', -1), '2025-12');
  assert.equal(C.addMonths('2026-12', 1), '2027-01');
  assert.equal(C.daysBetween('2026-11-01', '2026-11-30'), 29);
  assert.equal(C.addDays('2026-11-30', 1), '2026-12-01');
});

test('月次の目標は基準日の月だけを集計する', () => {
  const es = [e('2026-10-31', 'f', 5000), e('2026-11-01', 'f', 1000), e('2026-11-30', 'f', 2000), e('2026-11-10', 't', 9999)];
  const p = C.progress(food, es, '2026-11-15');
  assert.equal(p.current, 3000);
  assert.equal(p.start, '2026-11-01');
  assert.equal(p.end, '2026-11-30');
  assert.equal(p.totalDays, 30);
  assert.equal(p.elapsedDays, 15);
  assert.equal(p.remainDays, 16);
  assert.equal(p.remain, 27000);
});

test('上限タイプのペース：使う額が目安より少なければ先行、多ければ遅れ', () => {
  // 11/15 時点の目安は 15,000円、許容幅は ±1,500円
  assert.equal(C.progress(food, [e('2026-11-02', 'f', 10000)], '2026-11-15').pace, 'ahead');
  assert.equal(C.progress(food, [e('2026-11-02', 'f', 15500)], '2026-11-15').pace, 'ontrack');
  assert.equal(C.progress(food, [e('2026-11-02', 'f', 20000)], '2026-11-15').pace, 'behind');
});

test('上限タイプの 1日あたり使える額（超過していたら 0）', () => {
  assert.equal(C.progress(food, [e('2026-11-02', 'f', 14000)], '2026-11-15').perDay, 1000);
  assert.equal(C.progress(food, [e('2026-11-02', 'f', 40000)], '2026-11-15').perDay, 0);
});

test('期限付きの貯金タイプ：ペースと 1日あたり必要な額', () => {
  // 90日間。11/30 は 30日目 → 目安 33,333円
  const p = C.progress(trip, [e('2026-11-05', 't', 20000)], '2026-11-30');
  assert.equal(p.totalDays, 90);
  assert.equal(p.elapsedDays, 30);
  assert.equal(p.remainDays, 61);
  assert.equal(p.pace, 'behind');
  assert.equal(p.perDay, 80000 / 61);
  assert.equal(C.progress(trip, [e('2026-11-05', 't', 50000)], '2026-11-30').pace, 'ahead');
  assert.equal(C.progress(trip, [e('2026-11-05', 't', 100000)], '2026-11-30').pace, 'done');
});

test('期間の前と後', () => {
  const before = C.progress(trip, [], '2026-10-20');
  assert.equal(before.phase, 'before');
  assert.equal(before.pace, 'before');
  assert.equal(before.perDay, 100000 / 90);
  assert.equal(C.progress(trip, [e('2026-12-01', 't', 100000)], '2027-02-01').pace, 'done');
  assert.equal(C.progress(trip, [e('2026-12-01', 't', 99999)], '2027-02-01').pace, 'missed');
  assert.equal(C.progress(trip, [], '2027-02-01').perDay, null);
});

test('マイナスの記録（引き出し・返金）は差し引く', () => {
  assert.equal(C.progress(trip, [e('2026-11-05', 't', 30000), e('2026-11-06', 't', -5000)], '2026-11-30').current, 25000);
});

test('月次ビュー：月次の目標の達成判定と前月比', () => {
  const es = [e('2026-10-03', 'f', 25000), e('2026-11-03', 'f', 32000)];
  const oct = C.monthRow(food, es, '2026-10', '2026-11-20');
  assert.equal(oct.status, 'done');
  assert.equal(oct.actual, 25000);
  assert.equal(oct.prevActual, 0);
  const nov = C.monthRow(food, es, '2026-11', '2026-11-20');
  assert.equal(nov.status, 'active');
  assert.equal(nov.pace, 'behind');
  assert.equal(nov.diff, 7000);
  assert.equal(C.monthRow(food, es, '2026-11', '2026-12-05').status, 'missed');
});

test('月次ビュー：期限付きの目標は月の動きと累計', () => {
  const es = [e('2026-11-05', 't', 30000), e('2026-12-05', 't', 40000), e('2027-01-20', 't', 30000)];
  const dec = C.monthRow(trip, es, '2026-12', '2027-03-01');
  assert.equal(dec.actual, 40000);
  assert.equal(dec.diff, 10000);
  assert.equal(dec.cumulative, 70000);
  assert.equal(dec.status, 'active');
  const jan = C.monthRow(trip, es, '2027-01', '2027-03-01');
  assert.equal(jan.cumulative, 100000);
  assert.equal(jan.status, 'done');
});

test('その月に関係する目標', () => {
  assert.equal(C.activeInMonth(trip, '2026-10'), false);
  assert.equal(C.activeInMonth(trip, '2027-01'), true);
  assert.equal(C.activeInMonth(trip, '2027-02'), false);
  assert.equal(C.activeInMonth(food, '2025-12'), false);
  assert.equal(C.activeInMonth(food, '2026-01'), true);
});
