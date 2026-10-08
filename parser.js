/* Natural-language task parser.
   "Draft launch email friday !high #marketing ~1h"
   -> { title: "Draft launch email", due: "2026-10-02", priority: "high", tags: ["marketing"], estimate: 60 } */
(function (root) {
  const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const DAY_RE = "(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)";
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const PREFIX = "(?:(?:on|by|due)\\s+)?";

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  // Each rule: regex (matched against " text ") and a function returning a Date
  const DATE_RULES = [
    [new RegExp(`\\s${PREFIX}(today|tonight|eod)(?=\\s)`, "i"), (m, t) => t],
    [new RegExp(`\\s${PREFIX}(tomorrow|tmrw|tmr)(?=\\s)`, "i"), (m, t) => addDays(t, 1)],
    [new RegExp(`\\s${PREFIX}in\\s+(\\d{1,3})\\s+(day|days|week|weeks)(?=\\s)`, "i"),
      (m, t) => addDays(t, Number(m[1]) * (m[2].startsWith("week") ? 7 : 1))],
    [new RegExp(`\\s${PREFIX}next\\s+week(?=\\s)`, "i"), (m, t) => addDays(t, ((8 - t.getDay()) % 7) || 7)],
    [new RegExp(`\\s${PREFIX}(\\d{4})-(\\d{2})-(\\d{2})(?=\\s)`, "i"), (m) => new Date(+m[1], +m[2] - 1, +m[3])],
    [new RegExp(`\\s${PREFIX}${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?=\\s)`, "i"), (m, t) => monthDay(m[1], m[2], t)],
    [new RegExp(`\\s${PREFIX}(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}(?=\\s)`, "i"), (m, t) => monthDay(m[2], m[1], t)],
    [new RegExp(`\\s${PREFIX}(?:next\\s+|this\\s+)?${DAY_RE}(?=\\s)`, "i"), (m, t) => {
      const target = DAYS.indexOf(m[1].slice(0, 3).toLowerCase());
      return addDays(t, ((target - t.getDay() + 7) % 7) || 7);
    }],
  ];

  function monthDay(monthName, day, today) {
    const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase());
    const d = Number(day);
    if (month < 0 || d < 1 || d > 31) return null;
    let date = new Date(today.getFullYear(), month, d);
    if (date < today) date = new Date(today.getFullYear() + 1, month, d); // "jan 5" in October means next year
    return date;
  }

  const PRIORITY_RE = /\s(!!!|!!|!high|!urgent|!h|!med(?:ium)?|!m|!low|!l)(?=\s)/i;
  const PRIORITY_MAP = { "!!!": "high", "!high": "high", "!urgent": "high", "!h": "high", "!!": "med", "!med": "med", "!medium": "med", "!m": "med", "!low": "low", "!l": "low" };
  const TAG_RE = /\s#([\p{L}\p{N}_-]{1,30})(?=\s)/giu;
  const ESTIMATE_RE = /\s~(\d+(?:\.\d+)?)\s?(m|min|mins|minutes|h|hr|hrs|hours)(?=\s)/i;

  function parse(text, now = new Date()) {
    const today = startOfDay(now);
    let s = ` ${text} `;
    const out = { title: "", due: null, priority: null, tags: [], estimate: null };

    s = s.replace(TAG_RE, (m, tag) => { if (!out.tags.includes(tag.toLowerCase())) out.tags.push(tag.toLowerCase()); return " "; });

    s = s.replace(PRIORITY_RE, (m, p) => { out.priority = PRIORITY_MAP[p.toLowerCase()]; return " "; });

    s = s.replace(ESTIMATE_RE, (m, n, unit) => {
      const mins = unit.toLowerCase().startsWith("h") ? Number(n) * 60 : Number(n);
      out.estimate = Math.round(mins);
      return " ";
    });

    for (const [re, toDate] of DATE_RULES) {
      const m = s.match(re);
      if (!m) continue;
      const d = toDate(m, today);
      if (d && !isNaN(d)) {
        out.due = iso(d);
        s = s.replace(re, " ");
        break;
      }
    }

    out.title = s.replace(/\s+/g, " ").trim();
    return out;
  }

  // Turn a task back into editable text that parses to the same task
  function compose(task) {
    const parts = [task.title];
    if (task.due) parts.push(task.due);
    if (task.priority) parts.push(`!${task.priority}`);
    for (const t of task.tags || []) parts.push(`#${t}`);
    if (task.estimate) parts.push(task.estimate % 60 === 0 ? `~${task.estimate / 60}h` : `~${task.estimate}m`);
    return parts.join(" ");
  }

  const api = { parse, compose, iso };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FlowParser = api;
})(typeof window !== "undefined" ? window : globalThis);
