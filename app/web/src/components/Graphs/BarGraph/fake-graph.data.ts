export const weatherDataset = [
  {
    london: 59,
    newYork: 86,
    month: 'Jan'
  },
  {
    london: 50,
    newYork: 78,
    month: 'Feb'
  },
  {
    london: 47,
    newYork: 106,
    month: 'Mar'
  },
  {
    london: 54,
    newYork: 92,
    month: 'Apr'
  },
  {
    london: 57,
    newYork: 92,
    month: 'May'
  },
  {
    london: 60,
    newYork: 103,
    month: 'June'
  },
  {
    london: 59,
    newYork: 105,
    month: 'July'
  },
  {
    london: 65,
    newYork: 106,
    month: 'Aug'
  },
  {
    london: 51,
    newYork: 95,
    month: 'Sept'
  },
  {
    london: 60,
    newYork: 97,
    month: 'Oct'
  },
  {
    london: 67,
    newYork: 76,
    month: 'Nov'
  },
  {
    london: 61,
    newYork: 103,
    month: 'Dec'
  }
];

export function valueFormatter(value: number | null) {
  return `${value}mm`;
}
