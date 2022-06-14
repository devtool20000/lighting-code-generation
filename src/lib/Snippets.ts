export class SnippetPlaceholderGenerator {
  counter:number = 1

  next(defaultValue:any | undefined) : string{
    const placeholder = `\${${this.counter}:${defaultValue || ""}}`
    this.counter++
    return placeholder
  }

  nextEnd(defaultValue:any | undefined) : string{
    const placeholder = `\${~${this.counter}:${defaultValue || ""}}`
    this.counter++
    return placeholder
  }
}
