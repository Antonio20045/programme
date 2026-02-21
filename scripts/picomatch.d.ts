declare module 'picomatch' {
  type Matcher = (test: string) => boolean

  interface Options {
    dot?: boolean
    nocase?: boolean
    contains?: boolean
    matchBase?: boolean
  }

  function picomatch(
    glob: string | string[],
    options?: Options,
  ): Matcher

  function picomatch(
    glob: string | string[],
    options?: Options,
    returnState?: boolean,
  ): Matcher

  export = picomatch
}
