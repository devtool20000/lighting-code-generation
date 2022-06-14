import path = require("path")
import fs = require("fs")
import rollup = require("rollup")
import * as vscode from 'vscode'
import { SnippetPlaceholderGenerator } from "./Snippets"
const requireFromString = require('require-from-string')

const MATCH_EXPAND_NAME_PATTEN = /^([a-zA-Z0-9\-]+)/

function requireUncached(module:string) {
  delete require.cache[require.resolve(module)];
  return require(module);
}


export class CodeExpandEngine {

  public folderFilepath:string
  public codeExpandMapping:Record<string,CodeExpandFn> = {}
  private watcher:any

  public loadExpandScriptError: any = null
  

  constructor(public projectRoot:string, lightingScriptFolder:string = "lt"){
    this.folderFilepath = path.join(projectRoot,lightingScriptFolder)
  }

  initialCompileExpandScriptWatcher() : Promise<void> {

    let isInitial = true

    return new Promise((resolve, reject)=>{
      const entryFilepath = path.join(this.folderFilepath,"index.js")
    const nodeModulePath = path.join(this.projectRoot,"node_modules")

    this.watcher = rollup.watch({
      input:entryFilepath,
      watch:{
        skipWrite:true
      }
    })

    this.watcher.on("event",async (event:any)=>{
      if(event.code === "BUNDLE_END"){
        try {
          const result = await event.result.generate({
            format:"cjs"
          })
          const bundleCode = result.output[0].code
          this.codeExpandMapping = requireFromString(bundleCode,{
            prependPaths:[nodeModulePath]
          }).config
          this.loadExpandScriptError = null
          if (isInitial) {
            isInitial = false
            resolve()  
          }
        }
        catch (e) {
          this.loadExpandScriptError = e
          console.log("load expand script error:")
          console.log(this.loadExpandScriptError)
          if (isInitial) {
            isInitial = false
            reject(e)  
          }
        }
        
      }
      if(event.code === "BUNDLE_END" || event.code === "ERROR"){
        event.result.close()
      }
    })
    })
  }

  dispose(){
    this.watcher.close()
  }
  /*
  result can be 
  * string (which is the return value)
  * {text:string,rollback:()=>{}} which is return value and rollback function, rollback function can only be called once

  */ 
  expandQuery(context:CodeExpandContext): any {
    context.root = this.projectRoot
    context.clipboard = vscode.env.clipboard

    context.expand = (context) =>{
      return this.expandQuery(context) || ""
    }
    const expandNameMatch = MATCH_EXPAND_NAME_PATTEN.exec(context.text)
    if(!expandNameMatch) {
      throw new Error(`can't find expand item from ${context.text}`)
    }
    const expandName = expandNameMatch[1]
    if (!this.codeExpandMapping[expandName]) {
      throw new Error(`expand item [${expandName}] not registered`)
    }
    try {
      return this.codeExpandMapping[expandName](context) || ""
    }
    catch (e) {
      throw new Error(`expand item [${expandName}] failed with inner error ${e}`)
    }
    
    return ""
  }
}


type CodeExpandFn = (ctx:CodeExpandContext) => (Promise<string> | string)

export interface CodeExpandContext {
  text:string
  root?:string
  filepath:string
  selectedText?:string
  placeholders:SnippetPlaceholderGenerator
  from: "editor" | "explorer"
  services:Record<string,any>
  ide:IDE
  clipboard?:vscode.Clipboard
  expand?:(context:CodeExpandContext)=> (Promise<string> | string)
}


export interface IDE {
  openFile(filepath:string):void
}


