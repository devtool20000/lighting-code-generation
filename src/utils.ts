import {
  commands,
  env,
  Range,
  Selection,
  TextEditor,
  workspace,
  Uri,
  FileType,
  SnippetString
} from "vscode";

const LEADING_WHITESPACE_PATTERN = /^(\s*)/;
const INDENT_PATTERN = /^(\s*)$/;
const FIND_POTENTIAL_END_PATTERN = /\${~(\d+):[^}]*}/g
const END_PATTERN = "$END$"

export function getIndent(text: string): string {
  const match = LEADING_WHITESPACE_PATTERN.exec(text);
  if (match) {
    return match[1];
  } else {
    return "";
  }
}

function getIndentForCurrent(previousLiteral: string) {
  const lines = previousLiteral.split("\n");
  const lastLine = lines[lines.length - 1];
  const match = INDENT_PATTERN.exec(lastLine);
  if (match) {
    return match[1];
  } else {
    return "";
  }
}

export function withIndent(indent: string, code: string) {
  return code.split("\n").join(`\n${indent}`);
}

// replace text and them move cursor to $END$
// preserve this to better handle add comment and then remove undo, the selection is still correct
export async function replaceTextAndMoveCursorToEnd(
  textEditor: TextEditor,
  range: Range,
  text: string
) {
  // reomve the $END$ from the final generation text 
  // and find the final cursor location
  const firstEndIndexInReplaceText = text.indexOf("$END$")
  const finalText = text.replace(END_PATTERN,"")
  const remainTextLastOffset = textEditor.document.offsetAt(range.start)
  const finalCursorOffset = firstEndIndexInReplaceText === -1 ? remainTextLastOffset + finalText.length : remainTextLastOffset + firstEndIndexInReplaceText
  


  await textEditor.edit((builder) => {
    builder.replace(range, finalText);
  });
  const finalCurosrPosition = textEditor.document.positionAt(finalCursorOffset)
  textEditor.selection = new Selection(finalCurosrPosition, finalCurosrPosition);
}

export async function replaceTextAndMoveCursor(
  textEditor: TextEditor,
  range: Range,
  text: string
) {
  await textEditor.edit((builder)=>{
    builder.delete(range)
  },{undoStopBefore:true,undoStopAfter:false})
  
  await textEditor.insertSnippet(new SnippetString(rewriteFinalEndPositionInSnippet(text)),range.start,{
    undoStopBefore:false,
    undoStopAfter:true
  })
}

function rewriteFinalEndPositionInSnippet(text:string) : string{
  const matches = [...text.matchAll(FIND_POTENTIAL_END_PATTERN)]
  if(matches.length === 0){
    return text
  }

  const largestEndCandidateNumber = Math.max(...matches.map(x=>Number(x[1])))
  return text.replace(FIND_POTENTIAL_END_PATTERN, (match)=>{
    const number = Number(new RegExp(FIND_POTENTIAL_END_PATTERN).exec(match)![1])
    if(number === largestEndCandidateNumber) {
      return match.replace(`\${~${number}`,"${0")
    }
    else {
      return ""
    }
  })
}

export async function getSelectedFilepathFromFileExplorer() : Promise<string>{
  const originalClipboard = await env.clipboard.readText();

  await commands.executeCommand('copyFilePath');
  const filepath = await env.clipboard.readText();  // returns a string

  await env.clipboard.writeText(originalClipboard);
  return filepath
}
