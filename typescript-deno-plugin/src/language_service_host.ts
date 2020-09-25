import clone from "clone";
import path from "path";
import tss from "typescript/lib/tsserverlibrary";

import { getImportModules } from "../../core/deno_deps";
import { ModuleResolver } from "../../core/module_resolver";
import { isUntitledDocument } from "../../core/util";
import { Logger } from "./logger";
import { TDPConfigMgr } from "./config";

export class DenoLanguageServerHost {
  private constructor(
    private original_host: tss.LanguageServiceHost,
    private new_host: tss.LanguageServiceHost
  ) {}

  static decorate(
    configMgr: TDPConfigMgr,
    host: tss.LanguageServiceHost,
    project: tss.server.Project,
    logger: Logger
  ): DenoLanguageServerHost {
    const original_host: tss.LanguageServiceHost = clone(host, true, 1);

    // start decorate
    if (original_host.resolveModuleNames) {
      host.resolveModuleNames = (
        moduleNames: string[],
        containingFile: string
      ): (tss.ResolvedModule | tss.ResolvedModuleFull | undefined)[] => {
        logger.info(
          "resolveModuleNames" +
            JSON.stringify(moduleNames) +
            "  " +
            containingFile
        );
        // TODO: enable conditionally
        if (
          !configMgr.getPluginConfig()?.enable &&
          original_host.resolveModuleNames
        ) {
          logger.info(
            "original one triggered reason: " +
              JSON.stringify(configMgr.getPluginConfig())
          );
          return original_host.resolveModuleNames(
            moduleNames,
            containingFile,
            undefined,
            undefined,
            original_host.getCompilationSettings()
          );
        }

        // containingFile may be `untitled: ^ Untitled-1`
        const realContainingFile = isUntitledDocument(containingFile)
          ? path.join(project.getCurrentDirectory(), "untitled")
          : // in Windows.
            // containingFile may be a unix-like style
            // eg. c:/Users/admin/path/to/file.ts
            // This is not a legal file path in Windows
            // It will cause a series of bugs, so here we get the real file path
            containingFile;

        // const importMapsFilepath = this.configurationManager.config.import_map
        //   ? path.isAbsolute(this.configurationManager.config.import_map)
        //     ? this.configurationManager.config.import_map
        //     : path.resolve(
        //         project.getCurrentDirectory(),
        //         this.configurationManager.config.import_map
        //       )
        //   : undefined;

        const resolver = ModuleResolver.create(
          realContainingFile
          // importMapsFilepath
        );

        const content = tss.sys.readFile(containingFile, "utf8");

        // handle @deno-types
        if (content && content.indexOf("// @deno-types=") >= 0) {
          const sourceFile = tss.createSourceFile(
            containingFile,
            content,
            tss.ScriptTarget.ESNext,
            true
          );

          const modules = getImportModules(tss)(sourceFile);

          for (const m of modules) {
            if (m.hint) {
              const index = moduleNames.findIndex((v) => v === m.moduleName);

              moduleNames[index] = m.hint.text;
            }
          }
        }

        const resolvedModules = resolver.resolveModules(moduleNames);

        logger.info(
          "resolvedModules: " +
            resolvedModules.map((it) => it?.filepath ?? "no eotk").join(",")
        );

        // try resolve typeReferenceDirectives
        for (const resolvedModule of resolvedModules) {
          if (!resolvedModule) {
            continue;
          }

          const content = tss.sys.readFile(resolvedModule.filepath);

          if (!content) {
            continue;
          }

          const { typeReferenceDirectives } = tss.preProcessFile(
            content,
            true,
            true
          );

          if (!typeReferenceDirectives.length) {
            continue;
          }

          const _resolver = ModuleResolver.create(
            resolvedModule.filepath
            // importMapsFilepath
          );

          const modules = _resolver.resolveModules(
            typeReferenceDirectives.map((v) => v.fileName)
          );

          for (const m of modules) {
            if (m) {
              resolvedModule.origin = m.origin;
              resolvedModule.filepath = m.filepath;
            }
          }
        }

        return resolvedModules.map((v) => {
          if (!v) {
            return v;
          }

          const result: tss.ResolvedModuleFull = {
            extension: v.extension as tss.Extension,
            isExternalLibraryImport: false,
            resolvedFileName: v.filepath,
          };

          return result;
        });
      };
    }

    if (original_host.resolveTypeReferenceDirectives) {
      host.resolveTypeReferenceDirectives = (
        typeDirectiveNames: string[],
        containingFile: string,
        ...rest
      ) => {
        logger.info(
          "resolveTypeReferenceDirectives: " +
            JSON.stringify(typeDirectiveNames) +
            "   " +
            containingFile
        );
        if (!configMgr.getPluginConfig()?.enable) {
          if (original_host.resolveTypeReferenceDirectives) {
            return original_host.resolveTypeReferenceDirectives(
              typeDirectiveNames,
              containingFile,
              ...rest
            );
          }
          return [];
        }

        // containingFile may be `untitled: ^ Untitled-1`
        const realContainingFile = isUntitledDocument(containingFile)
          ? path.join(project.getCurrentDirectory(), "untitled")
          : // in Windows.
            // containingFile may be a unix-like style
            // eg. c:/Users/admin/path/to/file.ts
            // This is not a legal file path in Windows
            // It will cause a series of bugs, so here we get the real file path
            containingFile;

        if (!tss.sys.fileExists(realContainingFile)) {
          return [];
        }

        const import_map = configMgr.getProjectConfig()?.import_map;
        const importMapsFilepath = import_map
          ? path.isAbsolute(import_map)
            ? import_map
            : path.resolve(project.getCurrentDirectory(), import_map)
          : undefined;

        const resolver = ModuleResolver.create(
          realContainingFile,
          importMapsFilepath
        );

        const result: (tss.ResolvedTypeReferenceDirective | undefined)[] = [];

        for (const typeDirectiveName of typeDirectiveNames) {
          const [resolvedModule] = resolver.resolveModules([typeDirectiveName]);

          // if module found. then return the module file
          if (resolvedModule) {
            const target: tss.ResolvedTypeReferenceDirective = {
              primary: false,
              resolvedFileName: resolvedModule.filepath,
            };

            result.push(target);
            continue;
          }

          // If the module does not exist, then apply the native reference method
          if (original_host.resolveTypeReferenceDirectives) {
            const [target] = original_host.resolveTypeReferenceDirectives(
              [typeDirectiveName],
              containingFile,
              ...rest
            );

            result.push(target);
          }
        }

        return result;
      };
    }

    // end decorate

    return new DenoLanguageServerHost(original_host, host);
  }
  getOriginalOne(): tss.LanguageServiceHost {
    return this.original_host;
  }
  getNewOne(): tss.LanguageServiceHost {
    return this.new_host;
  }
}
