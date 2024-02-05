const ClientError = require("./classes/AoiError");
const { Collection } = require("discord.js");
const AoiManager = require("./classes/AoiManager");
const { getObjectKey, toParse } = require("./function/parser");
const ConditionChecker = require("./function/condition");
const { unpack, findAndTransform, updateParamsFromArray } = require("./prototype");

class TaskCompleter {
  constructor(
    code,
    eventData,
    discord,
    command,
    database,
    availableFunction,
    onlySearchFunction,
  ) {
    this.data = [];
    this.searchedFunctions = [];
    this.eventData = eventData;
    this.discord = discord;
    this.command = command;
    this.database = database;
    this.availableFunction = availableFunction;
    this.onlySearchFunction = onlySearchFunction;
    this.code = findAndTransform(code, onlySearchFunction);
    this.foundFunctions = this.searchFunctions();
  }

  escapeRegex(input) {
    return input.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  }

  searchFunctions() {
    let onlySearchFunctions = this.onlySearchFunction;
    let foundFunctions = [];
    let matchingFunctions = onlySearchFunctions.filter((func) =>
      this.code.includes(func),
    );
    const functionSegments = this.code.split("$");
    for (const functionSegment of functionSegments) {
      let matchingFunction = matchingFunctions.filter(
        (func) => func === `$${functionSegment}`.slice(0, func.length),
      );

      if (!matchingFunction.length) {
        continue;
      }

      if (matchingFunction.length === 1) {
        foundFunctions.push(matchingFunction[0]);
      } else if (matchingFunction.length > 1) {
        foundFunctions.push(
          matchingFunction.sort((a, b) => b.length - a.length)[0],
        );
      }
    }

    return foundFunctions;
  }

  async completesV4If(inputCode) {
    let code = inputCode;
    if (!code.toLowerCase().includes("$if[")) return code;
    for (let ifBlock of code
      .split(/\$if\[/gi)
      .slice(1)
      .reverse()) {
      const ifOccurrences = code.toLowerCase().split("$if[").length - 1;

      if (!code.toLowerCase().includes("$endif")) {
        this.sendErrorMessage(`is missing $endif`, false, "$if");
        return "";
      }

      const entireBlock = code
        .split(/\$if\[/gi)
        [ifOccurrences].split(/\$endif/gi)[0];

      ifBlock = code.split(/\$if\[/gi)[ifOccurrences].split(/\$endif/gi)[0];

      let condition = ifBlock.split("\n")[0].trim();

      condition = condition.slice(0, condition.length - 1);

      let pass = false;
      try {
        const taskCompleter = new TaskCompleter(
          `$checkCondition[${condition}]`,
          this.eventData,
          this.discord,
          this.command,
          this.database,
          this.availableFunction,
          this.onlySearchFunction,
        );
        const response = await taskCompleter.completeTask();
        pass = response.trim() == "true";
      } catch (err) {
        pass = false;
      }

      const hasElseIf = ifBlock.toLowerCase().includes("$elseif");

      const elseIfBlocks = {};

      if (hasElseIf) {
        for (const elseIfData of ifBlock.split(/\$elseif\[/gi).slice(1)) {
          if (!elseIfData.toLowerCase().includes("$endelseif")) {
            this.sendErrorMessage(`is missing $endelseIf!`, false, "$elseIf");
            return "";
          }

          const insideBlock = elseIfData.split(/\$endelseIf/gi)[0];

          let elseIfCondition = insideBlock.split("\n")[0].trim();

          elseIfCondition = elseIfCondition.slice(
            0,
            elseIfCondition.length - 1,
          );

          const elseIfCode = insideBlock.split("\n").slice(1).join("\n");

          elseIfBlocks[elseIfCondition] = elseIfCode;

          ifBlock = ifBlock.replace(
            new RegExp(
              `\\$elseif\\[${this.escapeRegex(insideBlock)}\\$endelseif`,
              "mi",
            ),
            "",
          );
        }
      }

      const hasElse = ifBlock.toLowerCase().includes("$else");

      const ifCodeBlock = hasElse
        ? ifBlock
            .split("\n")
            .slice(1)
            .join("\n")
            .split(/\$else/gi)[0]
        : ifBlock
            .split("\n")
            .slice(1)
            .join("\n")
            .split(/\$endif/gi)[0];

      const elseCodeBlock = hasElse
        ? ifBlock.split(/\$else/gi)[1].split(/\$endif/gi)[0]
        : "";

      let passes = false;

      let lastCodeBlock;

      if (hasElseIf) {
        for (const elseIfEntry of Object.entries(elseIfBlocks)) {
          if (!passes) {
            let response = false;
            try {
              const taskCompleter = new TaskCompleter(
                `$checkCondition[${elseIfEntry[0]}]`,
                this.eventData,
                this.discord,
                this.command,
                this.database,
                this.availableFunction,
                this.onlySearchFunction,
              );
              const result = await taskCompleter.completeTask();
              response = result.trim() == "true";
            } catch (err) {
              response = false;
            }
            if (response) {
              passes = true;
              lastCodeBlock = elseIfEntry[1];
            }
          }
        }
      }

      code = code.replace(/\$if\[/gi, "$if[").replace(/\$endif/gi, "$endif");
      code = code.replaceLast(
        `$if[${entireBlock}$endif`,
        pass ? ifCodeBlock : passes ? lastCodeBlock : elseCodeBlock,
      );
    }
    return code;
  }

  async completeTaskCallback(
    func,
    context,
    callback,
  ) {
    if (typeof callback === "function") {
      try {
        const result = await callback(context);

        this.suppressError = context.suppressErrors || this.suppressError;
        this.localVars = context.localVars || this.localVars;
        this.array = context.array || this.array;
        this.random = context.random || this.random;
        this.callback_query = context.callback_query || this.callback_query;
        if (context.discord?.globalVars) {
          this.discord.globalVars = context.discord.globalVars;
        }

        return result;
      } catch (err) {
        if (`${err}`.includes("DiscordError")) {
          const text = `❌ **DiscordError[$${func}]:**\`${`${err}`
            .split(":")
            .slice(1)
            .join(" ")}\``;
          this.sendErrorMessage(text, true, func);
        } else {
          const text = `❌ **Error[$${func}]:**\`${`${err}`
            .split(":")
            .slice(1)
            .join(" ")}\``;
          this.sendErrorMessage(text, true, func);
        }
        this.isError = true;
      }
    } else if (typeof callback.code === "string") {
      try {
        const code = updateParamsFromArray(
          callback.code,
          callback.params || [],
          context.splits,
        );
        const taskCompleter = new TaskCompleter(
          code,
          this.eventData,
          this.discord,
          this.command,
          this.database,
          this.availableFunction,
          this.onlySearchFunction,
        );
        return await taskCompleter.completeTask();
      } catch (err) {
        console.log(err);
      }
    } else {
      new ClientError(
        undefined,
        "the specified parameters for creating a custom function do not match the requirements",
        "addFunction",
        func,
      );
    }
  }

  async completeTask() {
    this.code = await this.completesV4If(this.code);
    this.foundFunctions = await this.searchFunctions();
    for (const func of this.foundFunctions.reverse()) {
      const codeSegment = unpack(this.code, func.toLowerCase());

      this.data.push({
        name: func,
        inside: codeSegment.inside,
        splits: codeSegment.splits,
      });

      const functionName = func.replace("$", "").replace("[", "");

      const dataContext = {
        data: this.data,
        inside: codeSegment.inside,
        splits: codeSegment.splits.map((inside) =>
          inside.trim() === "" ? undefined : inside,
        ),
        localVars: this.localVars,
        random: this.random,
        array: this.array,
        callback_query: this.callback_query,
        event: this.eventData,
        discord: this.discord,
        code: this.code,
        command: this.command,
        isError: false,
        argsCheck: (amount) => {
          if (!dataContext.splits[0] || dataContext.splits.length < amount) {
            dataContext.sendError(
              `Expected ${amount} arguments but got ${
                dataContext.splits[0] ? dataContext.splits.length : 0
              }`,
            );
          }
        },
        checkArgumentTypes(expectedArgumentTypes) {
          if (dataContext.isError) return;
          const argument = dataContext.splits;
          for (
            let argumentIndex = 0;
            argumentIndex < argument.length;
            argumentIndex++
          ) {
            const actualArgumentType = toParse(argument[argumentIndex]);
            if (!expectedArgumentTypes[argumentIndex]) {
              expectedArgumentTypes[argumentIndex] = "unknown";
            }
            const expectedArgumentTypeSet = new Set(
              expectedArgumentTypes[argumentIndex]
                .split("|")
                .map((arg) => arg.trim()),
            );

            if (expectedArgumentTypeSet.has("unknown")) continue;

            const isVariadic = new Set(
              expectedArgumentTypes[argumentIndex]
                .split("|")
                .map((arg) => arg.trim().includes("...")),
            ).has(true);
            if (isVariadic) {
              const variadicTypes = new Set(
                expectedArgumentTypes[argumentIndex]
                  .split("|")
                  .map((arg) => arg.trim())
                  .join(" ")
                  .split("...")
                  .map((arg) => (arg ? arg.trim() : undefined)),
              );
              const variadicTypesName = expectedArgumentTypes[argumentIndex];
              const sliceTypes = argument.slice(argumentIndex);
              for (
                let argumentIndex = 0;
                argumentIndex < sliceTypes.length;
                argumentIndex++
              ) {
                const nextExpectedType = toParse(
                  `${sliceTypes[argumentIndex]}`,
                );
                const actualArgumentType = toParse(
                  `${sliceTypes[argumentIndex]}`,
                );
                if (variadicTypesName.includes("...unknown")) break;
                if (!variadicTypes.has(nextExpectedType)) {
                  dataContext.sendError(
                    `The ${
                      argumentIndex + 1
                    }-th argument following the variadic parameter in the function ${functionName} should be of type ${variadicTypesName}, but the received value is of type ${actualArgumentType}`,
                  );
                }
              }
              break;
            } else if (!expectedArgumentTypeSet.has(actualArgumentType)) {
              dataContext.sendError(
                `The ${
                  argumentIndex + 1
                }-th argument in the function ${functionName} should be one of the types ${
                  expectedArgumentTypes[argumentIndex]
                }, but the provided value is of type ${actualArgumentType}`,
              );
            }
          }
        },
        sendError: (error, custom) => {
          if (!error) return;
          dataContext.isError = true;
          this.sendErrorMessage(error, custom, func);
        },
        database: this.database,
        foundFunctions: this.foundFunctions,
      };

      const functionRun = this.availableFunction.get(
        `$${functionName.toLowerCase()}`,
      );

      if (!functionRun) {
        throw new ClientError(
          undefined,
          `Function '$${functionName}' not found`,
          this.command.name,
        );
      }

      let resultFunction = await this.completeTaskCallback(
        functionName,
        dataContext,
        "callback" in functionRun ? functionRun.callback : functionRun,
      );

      this.code = this.code.replaceLast(
        codeSegment.splits.length > 0
          ? `${func.toLowerCase()}[${codeSegment.inside}]`
          : `${func.toLowerCase()}`,
        `${resultFunction}`,
      );

      if (dataContext.isError || this.isError) {
        this.code = "";
        break;
      }
    }
    return this.code;
  }

  sendErrorMessage(
    error,
    custom,
    functionName,
  ) {
    if (this.suppressError && this.eventData?.channel?.send) {
      return this.eventData.channel.send(this.suppressError);
    } else if (
      this.eventData?.channel?.send
    ) {
      return this.eventData.channel.send(
        custom ? error : `❌ **${functionName}:**\`${error}\``,
      );
    } else {
      throw new ClientError(undefined, error, this.command.name, functionName);
    }
  }
}

module.exports = TaskCompleter;
