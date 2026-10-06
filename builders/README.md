# Builders

Builders are reusable GNU Make implementations selected by catalog name. Every
builder implements the standard step contract and receives only resolved,
generated inputs. Package-specific behavior must be a named tracked hook, never
an inline catalog command.

Builder files will be added with the plan emitter so their interface can be
tested rather than guessed in advance.
