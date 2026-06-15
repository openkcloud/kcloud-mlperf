export const join = (root: string, sublink: string) => {
  return `${root}/${sublink}`.replace(/(\/){2,}/g, '/');
};
