// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import path = require("path");
import * as vscode from "vscode";
import { fileCommentConfig } from "./config";
import { CodeExpandEngine } from "./lib/CodeExpandEngine";
import { SnippetPlaceholderGenerator } from "./lib/Snippets";
import { getIndent, getSelectedFilepathFromFileExplorer, replaceTextAndMoveCursor, replaceTextAndMoveCursorToEnd, withIndent } from "./utils";
// const crypto = require('crypto')

let codeExpandEngine: CodeExpandEngine;
let globalRollbackCallback: Function | null;
// let globalRollbackChecksum:string | null;

async function initializeCodeExpandEngineIfNeeds() {
  if (!codeExpandEngine) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }
    codeExpandEngine = new CodeExpandEngine(workspaceFolders[0].uri.fsPath);
    await codeExpandEngine.initialCompileExpandScriptWatcher();
  }
}


// function saveCurrentFileChecksum() {
//   if(!vscode.window.activeTextEditor){
//     return
//   }
//   const document = vscode.window.activeTextEditor.document
//   const text = document.getText()
//   const filepath = document.uri.fsPath
//   const fileHash = crypto.createHash('md5').update(text).digest("hex")
//   globalRollbackChecksum = `${filepath}@${fileHash}`
//   console.log("save checksum",globalRollbackChecksum)
// }

// function clearGlobalRollback(){
//   globalRollbackCallback = null
//   globalRollbackChecksum = null
// }



// this method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated

  // initial code expandEngine not available
  await initializeCodeExpandEngineIfNeeds();

  // excute In Editor Generation
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lighting-code-generation.execute",
      async () => {
        const textEditor = vscode.window.activeTextEditor;

        if (textEditor) {
          const currentLineNumber = textEditor.selection.active.line;
          const currentLine = textEditor.document.lineAt(currentLineNumber);
          const indent = getIndent(currentLine.text);

          const textBeforeCursorRange = new vscode.Range(
            currentLine.range.start,
            textEditor.selection.start
          );
          const textBeforeCursor = textEditor.document.getText(
            textBeforeCursorRange
          );

          let newText = textBeforeCursor;
          const fileSuffix = path
            .extname(textEditor.document.fileName)
            .replace(".", "");

          let commentTemplate = "// $END$";
          // if not matched file, just use //
          if (fileCommentConfig[fileSuffix]) {
            commentTemplate = fileCommentConfig[fileSuffix];
          }

          let commentSegments = commentTemplate.split("$END$");
          let commentStart = commentSegments[0].trim();
          let commentEnd =
            commentSegments.length === 2 ? commentSegments[1].trim() : "";

          if (textBeforeCursor.indexOf(commentStart) === -1) {
            // insert comment
            newText = textBeforeCursor + `${commentTemplate}`;
            await replaceTextAndMoveCursorToEnd(
              textEditor,
              textBeforeCursorRange,
              newText
            );
          } else {
            // expand the result
            const currentLineText = currentLine.text;
            const commentStartPositionIndex =
              currentLineText.indexOf(commentStart);

            // nothing to expand
            if (commentStartPositionIndex === -1) {
              return;
            }
            const commentStartPosition = new vscode.Position(
              currentLineNumber,
              commentStartPositionIndex
            );
            const toReplaceRange = new vscode.Range(
              commentStartPosition,
              currentLine.range.end
            );

            const rawExpandText = textEditor.document.getText(toReplaceRange);

            let expression = rawExpandText.trim();
            expression = expression
              .replace(commentStart, "")
              .replace(commentEnd, "")
              .trim();
            const previousCursorPosition = textEditor.selection.active
            await expandAndReplaceExpression(textEditor, expression, toReplaceRange);
            
          }
        }
      }
    )
  );

  // excute In Editor Popup Generation
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lighting-code-generation.execute-editor-popup",
      async () => {
        let query = await vscode.window.showInputBox({
          title: "input expand query",
        });
        if (!query) {
          return;
        }

        const textEditor = vscode.window.activeTextEditor;
        query = query.trim()
        if (textEditor) {
          const toReplaceRange = new vscode.Range(
            textEditor.selection.start,
            textEditor.selection.end
          );
          await expandAndReplaceExpression(textEditor, query, toReplaceRange);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lighting-code-generation.execute-editor-popup-from-explorer",
      async () => {
        let query = await vscode.window.showInputBox({
          title: "input expand query",
        });
        if (!query) {
          return;
        }

        await expandAndReplaceExpression(null, query, null);
      }
    )
  );


  // paste text but move curor to end position marked as $0
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lighting-code-generation.paste-with-end-position",
      async () => {
        const textEditor = vscode.window.activeTextEditor;
        if (!textEditor) {
          return;
        }

        const currentLineNumber = textEditor.selection.active.line;
        const currentLine = textEditor.document.lineAt(currentLineNumber);
        const indent = getIndent(currentLine.text);

        const toReplaceRange = new vscode.Range(
          textEditor.selection.active,
          textEditor.selection.active
        );
        await replaceTextAndMoveCursor(
          textEditor,
          toReplaceRange,
          await vscode.env.clipboard.readText()
        );
      }
    )
  );
  
  // rollback
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lighting-code-generation.rollback",
      async () => {
        // await vscode.commands.executeCommand("undo");
        // TODO: not sure whether will work on folder generation use async here to make sure the checksum only happens async so won't block ui
        if(!globalRollbackCallback){
          return
        }
        await globalRollbackCallback()
        globalRollbackCallback = null
        // setTimeout(async ()=>{
        //   if (globalRollbackCallback) {
        //     const activeEditor = vscode.window.activeTextEditor
        //     if(!activeEditor){
        //       return
        //     }
        //     if(!globalRollbackChecksum){
        //       return
        //     }
        //     if(!globalRollbackChecksum.startsWith(activeEditor.document.uri.fsPath)) {
        //       return
        //     }
            
        //     const fileHash = crypto.createHash('md5').update(activeEditor.document.getText()).digest("hex")
        //     const currentHash = `${activeEditor.document.uri.fsPath}@${fileHash}`
        //     // not the right callback time
        //     if(currentHash !== globalRollbackChecksum) {
        //       return
        //     }
  
        //     // only rollback when user confirm
        //     const result = await vscode.window.showInformationMessage("Lighting Code Generation has extra rollback (e.g., extra file generations). Do you want to rollback?",...["Yes","No"])
        //     if(result === "Yes"){
        //       if(!globalRollbackChecksum){
        //         return
        //       }
        //       await globalRollbackCallback();
        //     }
        //     globalRollbackCallback = null;
        //     globalRollbackChecksum = null;
        //   }
        // },0)
      }
    )
  );

  // insert snippet
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lighting-code-generation.snippet",
      async () => {
        
      }
    )
  );



  console.log('"lighting-code-generation" is now active!');
}

async function expandAndReplaceExpression(textEditor: vscode.TextEditor | null, expression: string, toReplaceRange: vscode.Range | null) {
  let filepath = ""
  if(textEditor) {
    filepath = textEditor.document.uri.fsPath
  }
  else {
    filepath = await getSelectedFilepathFromFileExplorer()
  }
  let newText = ""
  const generateResult = await codeExpandEngine.expandQuery({
  filepath: filepath,
  text: expression,
  placeholders: new SnippetPlaceholderGenerator(),
  from: textEditor ? "editor" : "explorer",
  services: {},
  ide: {
    openFile:async (filepath)=>{
      const document = await vscode.workspace.openTextDocument(filepath)
      await vscode.window.showTextDocument(document)
    }
  }
});

  if (typeof generateResult === "object") {
    newText = generateResult.text || "";
    globalRollbackCallback = generateResult.rollback;
    // saveCurrentFileChecksum()
  } else if (typeof generateResult === "string") {
    newText = generateResult;
    globalRollbackCallback = null;
    // globalRollbackChecksum = null;
  } else if (typeof generateResult === "undefined") {
    newText = "";
    globalRollbackCallback = null;
    // globalRollbackChecksum = null;
  } else {
    throw new Error(
      "generator has wrong return value, please return string or {text:string,rollback:()=>{}}"
    );
  }

  // when editor is open
  if(textEditor) {
    await replaceTextAndMoveCursor(
      textEditor,
      toReplaceRange!,
      newText
    );
  }
 
}

// this method is called when your extension is deactivated
export function deactivate() {
  codeExpandEngine.dispose();
}
