declare module '*.hbs.js' {
  const fn: (data: Record<string, any>) => string;
  export default fn;
}
declare module '*.html' {
  const content: string;
  export default content;
}
