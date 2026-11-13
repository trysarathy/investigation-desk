/** YAML files are imported as strings (webpack `asset/source`, see next.config.mjs). */
declare module "*.yaml" {
  const text: string;
  export default text;
}
