// Fires reminders and credit-card bill alerts. Pure Node; the app passes in a notify(title, body, sound) callback.
// `sound` names the effect to play (see renderer/sounds.js).
const store = require('./store');
const T = require('./tools');

function once(key) {
  const n = store.get('notified');
  if (n[key]) return false;
  n[key] = Date.now();
  const keys = Object.keys(n);
  if (keys.length > 500) keys.slice(0, keys.length - 500).forEach((k) => delete n[k]);
  store.save('notified');
  return true;
}

function tick(notify, now = new Date()) {
  // 1) reminders (also fires ones missed while the app/Mac was off)
  const reminders = store.get('reminders');
  let changed = false;
  for (let i = reminders.length - 1; i >= 0; i--) {
    const r = reminders[i];
    const at = new Date(r.at);
    if (at > now) continue;
    const late = now - at > 5 * 60000;
    notify('Reminder', late ? `${r.text} (was due ${T.fmt(at)})` : r.text, 'reminder');
    changed = true;
    if (r.repeat !== 'none') {
      let next = at, guard = 0;
      while (next <= now && guard++ < 1000) next = T.advance(next, r.repeat);
      r.at = next.toISOString();
    } else {
      reminders.splice(i, 1);
    }
  }
  if (changed) store.save('reminders');

  // 2) credit card bills — alerts start at 9:00 local time
  if (now.getHours() < 9) return;
  const today = T.startOfDay(now);
  for (const c of store.get('cards')) {
    const paid = c.paid_through || '';
    const next = T.nextDue(c, now);
    const days = Math.round((next - today) / 864e5);
    const nk = T.dateKey(next);
    if (nk > paid) {
      if (days === 0 && once(`${c.name}:${nk}:due`)) notify('Card bill due TODAY', `${c.name} bill is due today.`, 'cardToday');
      else if (days > 0 && days <= c.remind_days_before && once(`${c.name}:${nk}:pre:${T.dateKey(today)}`))
        notify('Card bill coming up', `${c.name} bill due in ${days} day${days > 1 ? 's' : ''} (${nk}).`, 'cardSoon');
    }
    const prev = T.prevDue(c, now);
    const since = Math.round((today - prev) / 864e5);
    if (since > 0 && since <= 15 && T.dateKey(prev) > paid && once(`${c.name}:${T.dateKey(prev)}:over:${T.dateKey(today)}`))
      notify('Card bill OVERDUE', `${c.name} bill was due ${T.dateKey(prev)} (${since} day${since > 1 ? 's' : ''} ago). Say "paid ${c.name}" once settled.`, 'cardOverdue');
  }
}

function start(notify) {
  tick(notify);
  return setInterval(() => tick(notify), 30000);
}

module.exports = { start, tick };
