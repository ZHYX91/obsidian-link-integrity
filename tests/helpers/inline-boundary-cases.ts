/** Block, nested-label and container expectations independently checked against CommonMark 0.31.2. */
export const inlineBoundaryCases: readonly {
  readonly markdown: string;
  readonly references: readonly (readonly [target: string, raw: string])[];
  readonly native?: readonly (readonly [target: string, raw: string])[];
}[] = [
  { markdown: '# [label](Target "title\n[[Missing]]")', references: [["Missing", "[[Missing]]"]] },
  { markdown: '# [label\ntext](Target "[[Missing]]")', references: [["Missing", "[[Missing]]"]] },
  { markdown: '# `unfinished\n[[Missing]]`', references: [["Missing", "[[Missing]]"]] },
  ...["#", "###", "> #", "- #"].map((prefix) => ({
    markdown: `${prefix} [label](Target "[[Missing]]")`,
    references: [["Target", '[label](Target "[[Missing]]")']] as const,
  })),
  ...["####### ", "\\# ", "#\u00a0", ""].map((prefix) => ({
    markdown: `${prefix}[label\ntext](Target "[[Missing]]")\n---`,
    references: [["Target", '[label\ntext](Target "[[Missing]]")']] as const,
  })),
  { markdown: '![outer [inner](Target)](image.png "[[Missing]]")',
    references: [["image.png", '![outer [inner](Target)](image.png "[[Missing]]")'], ["Target", "[inner](Target)"]] },
  { markdown: '[outer ![inner](image.png)](Target "[[Missing]]")',
    references: [["Target", '[outer ![inner](image.png)](Target "[[Missing]]")'], ["image.png", "![inner](image.png)"]] },
  { markdown: '[outer ![image [inner](Target)](image.png)](Ghost "[[Missing]]")',
    references: [["image.png", "![image [inner](Target)](image.png)"], ["Target", "[inner](Target)"], ["Missing", "[[Missing]]"]] },
  ...["[r]", "[inner][r]", "[r][]"].flatMap((inner) => [false, true].map((before) => ({
    markdown: `${before ? "[r]: Real\n\n" : ""}[outer ${inner}](Target "[[Missing]]")${before ? "" : "\n\n[r]: Real"}`,
    references: [["Missing", "[[Missing]]"]] as const,
    native: [["Real", inner]] as const,
  }))),
  ...["[r]", "[inner][r]", "[r][]"].map((inner) => ({
    markdown: `![outer ${inner}](image.png "[[Missing]]")\n\n[r]: Real`,
    references: [["image.png", `![outer ${inner}](image.png "[[Missing]]")`]] as const,
    native: [["Real", inner]] as const,
  })),
  ...["text\n[r]: Real", "```\n[r]: Real\n```", "<!--\n[r]: Real\n-->",
    '[label](Target "first\n[r]: Real\nend")'].map((definition) => ({
    markdown: `${definition}\n\n[outer [r]](Target "[[Missing]]")`,
    references: (definition.startsWith("[label]")
      ? [["Target", '[label](Target "first\n[r]: Real\nend")'], ["Target", '[outer [r]](Target "[[Missing]]")']]
      : [["Target", '[outer [r]](Target "[[Missing]]")']]) as readonly [string, string][],
  })),
  ...["<!--", "`", "%%"].map((literal) => ({
    markdown: `[label](Target "${literal}")\n\n[r]: Real\n\n[outer [r]](Target "[[Missing]]")`,
    references: [["Target", `[label](Target "${literal}")`], ["Missing", "[[Missing]]"]] as const,
    native: [["Real", "[r]"]] as const,
  })),
  ...["> [label](Target\n> \"[[Missing]]\")", "> [label](\n> Target)",
    '> [label](Target\n"[[Missing]]")', '> > [label](Target\n> > "[[Missing]]")',
    '> - [label](Target\n>   "[[Missing]]")', '- > [label](Target\n  > "[[Missing]]")',
    '>\t[label](Target\n>\t"[[Missing]]")',
    '> [label](Target\n> "first > literal\n> [[Missing]]"\n> )'].map((markdown) => ({
    markdown, references: [["Target", markdown.slice(markdown.indexOf("[label]"))]] as const,
  })),
  ...[false, true].map((before) => ({
    markdown: `> [label](Target\n> "<!--")\n>\n>${before ? " [r]: Real\n>\n>" : ""} [outer [r]](Target "[[Missing]]")${before ? "" : "\n>\n> [r]: Real"}`,
    references: [["Target", '[label](Target\n> "<!--")'], ["Missing", "[[Missing]]"]] as const,
    native: [["Real", "[r]"]] as const,
  })),
];
