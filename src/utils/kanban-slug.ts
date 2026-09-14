export function isValidFeatureSlug(value: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}
