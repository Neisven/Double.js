module.exports = {
  name: "$eval",
  callback: async (context) => {
    context.argsCheck(1);
    const content = context.inside;
    if (context.isError) return;

    const command = context.command.command
      ? context.command.name
      : { event: context.command.name };
    try {
      const response = await context.discord.evaluateCommand(
        command,
        content,
        context.event,
      );
      return response;
    } catch (err) {
      context.sendError(`Invalid usage: ${err}`);
      return "";
    }
  },
};
