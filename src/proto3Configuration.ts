'use strict';

import vscode = require('vscode');
import path = require('path');
import fs = require('fs');
import os = require('os');

export class Proto3Configuration {

    private readonly _configSection: string = 'proto';
    private static _instance: Proto3Configuration = null;
    private _config: vscode.WorkspaceConfiguration;
    private _configResolver: ConfigurationResolver;

    public static Instance(): Proto3Configuration {
        if (Proto3Configuration._instance == null) {
            this._instance = new Proto3Configuration();
        }
        return Proto3Configuration._instance;
    }

    private constructor() {
        this._config = vscode.workspace.getConfiguration(this._configSection);
        vscode.workspace.onDidChangeConfiguration(event => {
            this._config = vscode.workspace.getConfiguration(this._configSection);
        });
        this._configResolver = new ConfigurationResolver();
    }

    public getProtocPath(): string {
        return this._configResolver.resolve(
            this._config.get<string>('compiler.protoc_path'));
    }

    public getProtocArgs(): string[] {
        return this._configResolver.resolve(
            this._config.get<string[]>('compiler.protoc_args'));
    }

    public getClangFormatStyle(): string {
        return this._configResolver.resolve(
            this._config.get<string>('formatter.clang_format_style'));
    }

    public getProtocArgFiles(): string[] {
        return this.getProtocArgs().filter(arg => !arg.startsWith('-'));
    }

    public getProtocOptions(): string[] {
        return this.getProtocArgs().filter(arg => arg.startsWith('-'));
    }

    public getProtoPathOptions(): string[] {
        return this.getProtocOptions()
            .filter(opt => opt.startsWith('--proto_path') || opt.startsWith('-I'));
    }

    public getAllProtoPaths(): string[] {
        return this.getProtocArgFiles().concat(ProtoFinder.fromDir(vscode.workspace.rootPath));
    }

    public getTmpJavaOutOption(): string {
        return '--java_out=' + os.tmpdir();
    }

    public isCompileOnSave(): boolean {
        return this._config.get<boolean>('compile_on_save');
    }

}

class ProtoFinder {
    static fromDir(root: string): string[] {
        let search = function (dir: string): string[] {
            let files = fs.readdirSync(dir);

            let protos = files.filter(file => file.endsWith('.proto'))
                .map(file => path.join(path.relative(root, dir), file));

            files.map(file => path.join(dir, file))
                .filter(file => fs.statSync(file).isDirectory())
                .forEach(subDir => {
                    protos = protos.concat(search(subDir))
                });

            return protos;
        }
        return search(root);
    }
}

// Workaround to substitute variable keywords in the configuration value until
// workbench/services/configurationResolver is available on Extention API.
//
// 
// Some codes are copied from:
// src/vs/workbench/services/configurationResolver/node/configurationResolverService.ts
class ConfigurationResolver {

    constructor() {
        Object.keys(process.env).forEach(key => {
            this[`env.${key}`] = process.env[key];
        });
    }

    public resolve(value: string): string;
    public resolve(value: string[]): string[];
    public resolve(value: any): any {
        if (typeof value === 'string') {
            return this.resolveString(value);
        } else if (this.isArray(value)) {
            return this.resolveArray(value);
        }
        return value;
    }

    private isArray(array: any): array is any[] {
        if (Array.isArray) {
            return Array.isArray(array);
        }

        if (array && typeof (array.length) === 'number' && array.constructor === Array) {
            return true;
        }

        return false;
    }

    private resolveArray(value: string[]): string[] {
        return value.map(s => this.resolveString(s));
    }

    private resolveString(value: string): string {
        let regexp = /\$\{(.*?)\}/g;
        const originalValue = value;
        const resolvedString = value.replace(regexp, (match: string, name: string) => {
            let newValue = (<any>this)[name];
            if (typeof newValue === 'string') {
                return newValue;
            } else {
                return match && match.indexOf('env.') > 0 ? '' : match;
            }
        });

        return this.resolveConfigVariable(resolvedString, originalValue);
    }

    private resolveConfigVariable(value: string, originalValue: string): string {
        let regexp = /\$\{config\.(.+?)\}/g;
        return value.replace(regexp, (match: string, name: string) => {
            let config = vscode.workspace.getConfiguration();
            let newValue: any;
            try {
                const keys: string[] = name.split('.');
                if (!keys || keys.length <= 0) {
                    return '';
                }
                while (keys.length > 1) {
                    const key = keys.shift();
                    if (!config || !config.hasOwnProperty(key)) {
                        return '';
                    }
                    config = config[key];
                }
                newValue = config && config.hasOwnProperty(keys[0]) ? config[keys[0]] : '';
            } catch (e) {
                return '';
            }
            if (typeof newValue === 'string') {
                // Prevent infinite recursion and also support nested references (or tokens)
                return newValue === originalValue ? '' : this.resolveString(newValue);
            } else {
                return this.resolve(newValue) + '';
            }
        });
    }

    private get workspaceRoot(): string {
        return vscode.workspace.rootPath;
    }
}