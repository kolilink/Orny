export const toDateString = (date: Date = new Date()): string => {
  return date.toISOString().split('T')[0];
};

export const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateString(d);
};

export const getWeekStart = (): string => {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return toDateString(monday);
};

export const isThisWeek = (dateStr: string): boolean => {
  return dateStr >= getWeekStart() && dateStr <= toDateString();
};

// The calendar week immediately before the current one (Mon-Sun) — used to
// give Claude a real trend to compare against ("up/down vs last week"),
// not just a flat point-in-time snapshot.
export const isLastWeek = (dateStr: string): boolean => {
  const thisWeekStart = new Date(getWeekStart() + 'T00:00:00');
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const lastWeekEnd = new Date(thisWeekStart);
  lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
  return dateStr >= toDateString(lastWeekStart) && dateStr <= toDateString(lastWeekEnd);
};

export const isToday = (dateStr: string): boolean => {
  return dateStr === toDateString();
};

export const getLast7Days = (): string[] => {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    days.push(daysAgo(i));
  }
  return days;
};

export const getDayLabel = (dateStr: string): string => {
  const d = new Date(dateStr + 'T00:00:00');
  return ['D', 'L', 'M', 'M', 'J', 'V', 'S'][d.getDay()];
};
