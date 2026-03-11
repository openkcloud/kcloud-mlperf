export const progressValue = (value: string[]) => {
  const [_, stringVal] = value;
  const [a, b] = stringVal.split('/').map(Number);
  const percentage = (a / b) * 100;
  return { completed: a, total: b, percentage };
};
