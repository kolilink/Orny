export const formatGNF = (amount: number): string => {
  const rounded = Math.round(amount);
  const str = rounded.toString();
  const result: string[] = [];
  str.split('').reverse().forEach((digit, i) => {
    if (i > 0 && i % 3 === 0) result.push(' ');
    result.push(digit);
  });
  return result.reverse().join('') + ' GNF';
};

export const formatDate = (isoDate: string): string => {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};
