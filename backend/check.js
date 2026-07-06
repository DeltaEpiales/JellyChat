const fs = require('fs');
const acorn = require('acorn');
const code = fs.readFileSync('server.js', 'utf8');

let tokenStack = [];
try {
    for (let token of acorn.tokenizer(code, { ecmaVersion: 2022 })) {
        if (token.type.label === '{' || token.type.label === '(' || token.type.label === '[') {
            tokenStack.push({ type: token.type.label, loc: token.loc, start: token.start });
        } else if (token.type.label === '}' || token.type.label === ')' || token.type.label === ']') {
            let last = tokenStack.pop();
            // Simplified, assumes matched brackets
        }
    }
} catch (e) {
    console.log("Tokenizer error:", e);
    console.log("Stack:", tokenStack[tokenStack.length - 1]);
}
