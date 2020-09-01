import {
  searchX,
  listVersionsOfMod,
  modTreeOf,
  parseImportStatement,
} from "./import_utils";

test("import-enhance searchX", async () => {
  const result = await searchX("std");
  expect(result.length).not.toEqual(0);
});

test("import-enhance listVersionsOfMod", async () => {
  const result = await listVersionsOfMod("std");
  expect(result.latest).toBeTruthy();
  expect(result.versions.length).not.toEqual(0);
});

test("import-enhance modTreeOf", async () => {
  const result = await modTreeOf("std");
  expect(result.uploaded_at).toBeTruthy();
  expect(result.directory_listing.length).not.toEqual(0);
});

test("import-enhance parseImportStatement", async () => {
  const test_cases = <
    {
      imp: string;
      expect: { domain: string; module: string; version: string; path: string };
    }[]
  >[
    {
      imp: "import * from 'http://a.c/x/a.ts'",
      expect: {
        domain: "a.c",
        module: "x",
        version: "latest",
        path: "/a.ts",
      },
    },
    {
      imp: "import * from 'http://deno.land/std@0.66.0/fs/copy.ts'",
      expect: {
        domain: "deno.land",
        module: "std",
        version: "0.66.0",
        path: "/fs/copy.ts",
      },
    },
    {
      imp: "import * from 'https://deno.land/x/sha2@1.0.0/mod/sha224.ts'",
      expect: {
        domain: "deno.land",
        module: "sha2",
        version: "1.0.0",
        path: "/mod/sha224.ts",
      },
    },
    {
      imp: "import {} from 'https://deno.land/std@/';",
      expect: {
        domain: "deno.land",
        module: "std",
        version: "latest",
        path: "/",
      },
    },
  ];

  for (const test_case of test_cases) {
    const result = parseImportStatement(test_case.imp);
    expect(result?.domain).toEqual(test_case.expect.domain);
    expect(result?.module).toEqual(test_case.expect.module);
    expect(result?.version).toEqual(test_case.expect.version);
    expect(result?.path).toEqual(test_case.expect.path);
  }
});
