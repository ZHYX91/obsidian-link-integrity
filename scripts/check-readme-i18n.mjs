import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultProjectRoot = path.resolve(path.dirname(scriptPath), "..");
const config = {
  repository: "ZHYX91/obsidian-link-integrity",
  languages: [
    {
      label: "English",
      path: "README.md",
      sections: [
        "Screenshots",
        "Features",
        "Requirements and compatibility",
        "Installation",
        "Usage",
        "Settings",
        "Limitations",
        "Privacy and security",
        "Development",
        "Support",
        "License",
      ],
    },
    {
      label: "简体中文",
      path: "docs/i18n/README.zh-CN.md",
      sections: [
        "界面截图",
        "功能特性",
        "使用要求与兼容性",
        "安装",
        "使用",
        "设置",
        "限制",
        "隐私与安全",
        "开发",
        "支持",
        "许可证",
      ],
    },
    {
      label: "繁體中文",
      path: "docs/i18n/README.zh-TW.md",
      sections: [
        "介面截圖",
        "功能特性",
        "使用需求與相容性",
        "安裝",
        "使用",
        "設定",
        "限制",
        "隱私與安全",
        "開發",
        "支援",
        "授權",
      ],
    },
    {
      label: "Deutsch",
      path: "docs/i18n/README.de.md",
      sections: [
        "Screenshots",
        "Funktionen",
        "Anforderungen und Kompatibilität",
        "Installation",
        "Verwendung",
        "Einstellungen",
        "Einschränkungen",
        "Datenschutz und Sicherheit",
        "Entwicklung",
        "Support",
        "Lizenz",
      ],
    },
    {
      label: "Français",
      path: "docs/i18n/README.fr.md",
      sections: [
        "Captures d’écran",
        "Fonctionnalités",
        "Prérequis et compatibilité",
        "Installation",
        "Utilisation",
        "Paramètres",
        "Limitations",
        "Confidentialité et sécurité",
        "Développement",
        "Assistance",
        "Licence",
      ],
    },
    {
      label: "Русский",
      path: "docs/i18n/README.ru.md",
      sections: [
        "Снимки экрана",
        "Возможности",
        "Требования и совместимость",
        "Установка",
        "Использование",
        "Настройки",
        "Ограничения",
        "Конфиденциальность и безопасность",
        "Разработка",
        "Поддержка",
        "Лицензия",
      ],
    },
    {
      label: "Português (Brasil)",
      path: "docs/i18n/README.pt-BR.md",
      sections: [
        "Capturas de tela",
        "Recursos",
        "Requisitos e compatibilidade",
        "Instalação",
        "Uso",
        "Configurações",
        "Limitações",
        "Privacidade e segurança",
        "Desenvolvimento",
        "Suporte",
        "Licença",
      ],
    },
    {
      label: "日本語",
      path: "docs/i18n/README.ja.md",
      sections: [
        "スクリーンショット",
        "機能",
        "要件と互換性",
        "インストール",
        "使い方",
        "設定",
        "制限",
        "プライバシーとセキュリティ",
        "開発",
        "サポート",
        "ライセンス",
      ],
    },
    {
      label: "한국어",
      path: "docs/i18n/README.ko.md",
      sections: [
        "스크린샷",
        "기능",
        "요구 사항 및 호환성",
        "설치",
        "사용법",
        "설정",
        "제한 사항",
        "개인정보 보호 및 보안",
        "개발",
        "지원",
        "라이선스",
      ],
    },
    {
      label: "Español",
      path: "docs/i18n/README.es.md",
      sections: [
        "Capturas de pantalla",
        "Funciones",
        "Requisitos y compatibilidad",
        "Instalación",
        "Uso",
        "Ajustes",
        "Limitaciones",
        "Privacidad y seguridad",
        "Desarrollo",
        "Soporte",
        "Licencia",
      ],
    },
    {
      label: "Tiếng Việt",
      path: "docs/i18n/README.vi.md",
      sections: [
        "Ảnh chụp màn hình",
        "Tính năng",
        "Yêu cầu và khả năng tương thích",
        "Cài đặt",
        "Cách dùng",
        "Cài đặt",
        "Giới hạn",
        "Quyền riêng tư và bảo mật",
        "Phát triển",
        "Hỗ trợ",
        "Giấy phép",
      ],
    },
  ],
  requiredTokens: [
    "https://github.com/ZHYX91/obsidian-link-integrity/releases/latest",
    "`main.js`",
    "`manifest.json`",
    "`styles.css`",
    "`data.json`",
  ],
};

const ignoredDirectories = new Set([".git", "coverage", "dist", "node_modules", "release"]);
const normalizePath = (filePath) => filePath.split(path.sep).join("/");

function expectedNavigation(filePath) {
  return config.languages
    .map(({ label, path: targetPath }) => {
      const target = filePath === "README.md"
        ? `https://github.com/${config.repository}/blob/main/${targetPath}`
        : path.posix.relative(path.posix.dirname(filePath), targetPath);
      return `[${label}](${target})`;
    })
    .join(" · ");
}

function stripCodeFences(source) {
  return source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gmu, "");
}

function collectTargets(source) {
  const targets = [];
  const visibleSource = stripCodeFences(source);
  for (const match of visibleSource.matchAll(/(!?)\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^)]*)?\)/gu)) {
    targets.push({ kind: match[1] === "!" ? "image" : "link", target: match[2] });
  }
  for (const match of visibleSource.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)) {
    targets.push({ kind: "image", target: match[1] });
  }
  return targets;
}

function decodeTarget(rawTarget, filePath, errors) {
  const withoutWrapper = rawTarget.replace(/^<|>$/gu, "");
  try {
    return decodeURIComponent(withoutWrapper.split("#", 1)[0].split("?", 1)[0]);
  } catch {
    errors.push(`${filePath} contains an invalid encoded target: ${rawTarget}`);
    return null;
  }
}

function validateRepositoryPath(projectRoot, filePath, rawTarget, repositoryPath, errors) {
  const absoluteTarget = path.resolve(projectRoot, repositoryPath);
  const relativeTarget = path.relative(projectRoot, absoluteTarget);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    errors.push(`${filePath} contains a repository target outside the repository: ${rawTarget}`);
  } else if (!existsSync(absoluteTarget)) {
    errors.push(`${filePath} contains a missing repository target: ${rawTarget}`);
  }
}

function classifyRepositoryUrl(rawTarget) {
  let url;
  try {
    url = new URL(rawTarget);
  } catch {
    return null;
  }
  const blobPrefix = `/${config.repository}/blob/main/`;
  const rawPrefix = `/${config.repository}/main/`;
  if (url.hostname === "github.com" && url.pathname.startsWith(blobPrefix)) {
    return { kind: "blob", path: url.pathname.slice(blobPrefix.length) };
  }
  if (url.hostname === "raw.githubusercontent.com" && url.pathname.startsWith(rawPrefix)) {
    return { kind: "raw", path: url.pathname.slice(rawPrefix.length) };
  }
  return null;
}

function validateTargets(projectRoot, filePath, source, errors) {
  const isRoot = filePath === "README.md";
  for (const { kind, target: rawTarget } of collectTargets(source)) {
    if (rawTarget.startsWith("#")) {
      continue;
    }
    const repositoryUrl = classifyRepositoryUrl(rawTarget);
    if (repositoryUrl) {
      if (!isRoot) {
        errors.push(`${filePath} must use a relative target for repository content: ${rawTarget}`);
        continue;
      }
      if (kind === "image" && repositoryUrl.kind !== "raw") {
        errors.push(`${filePath} must use raw.githubusercontent.com for repository images: ${rawTarget}`);
      }
      if (kind === "link" && repositoryUrl.kind !== "blob") {
        errors.push(`${filePath} must use github.com blob/main for repository documents: ${rawTarget}`);
      }
      const decoded = decodeTarget(repositoryUrl.path, filePath, errors);
      if (decoded) {
        validateRepositoryPath(projectRoot, filePath, rawTarget, decoded, errors);
      }
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/iu.test(rawTarget)) {
      continue;
    }
    const decoded = decodeTarget(rawTarget, filePath, errors);
    if (!decoded) {
      continue;
    }
    if (isRoot) {
      errors.push(`${filePath} must use a canonical absolute GitHub target for repository content: ${rawTarget}`);
      continue;
    }
    const repositoryPath = path.resolve(path.dirname(path.resolve(projectRoot, filePath)), decoded);
    const relativePath = path.relative(projectRoot, repositoryPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      errors.push(`${filePath} contains a relative target outside the repository: ${rawTarget}`);
    } else if (!existsSync(repositoryPath)) {
      errors.push(`${filePath} contains a missing relative target: ${rawTarget}`);
    }
  }
}

function listLocalizedReadmes(projectRoot, directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        listLocalizedReadmes(projectRoot, path.join(directory, entry.name), result);
      }
      continue;
    }
    if (entry.isFile() && /^README[._-][A-Za-z0-9].*\.md$/u.test(entry.name)) {
      result.push(normalizePath(path.relative(projectRoot, path.join(directory, entry.name))));
    }
  }
  return result;
}

export function checkReadmeI18n(projectRoot = defaultProjectRoot) {
  const errors = [];
  const manifest = JSON.parse(readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
  const translatedReadmes = config.languages.slice(1).map(({ path: filePath }) => filePath);
  const actualTranslatedReadmes = readdirSync(path.join(projectRoot, "docs/i18n"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^README.*\.md$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const expectedTranslatedReadmes = translatedReadmes.map((filePath) => path.basename(filePath)).sort();
  if (JSON.stringify(actualTranslatedReadmes) !== JSON.stringify(expectedTranslatedReadmes)) {
    errors.push(`docs/i18n README set must be exactly: ${expectedTranslatedReadmes.join(", ")}`);
  }

  for (const language of config.languages) {
    const filePath = language.path;
    const absolutePath = path.join(projectRoot, filePath);
    if (!existsSync(absolutePath)) {
      errors.push(`Missing README file: ${filePath}`);
      continue;
    }
    const source = readFileSync(absolutePath, "utf8").replace(/^\uFEFF/u, "");
    const lines = source.split(/\r\n|\n|\r/u);
    if (lines[0] !== `# ${manifest.name}`) {
      errors.push(`${filePath} must start with the canonical title: # ${manifest.name}`);
    }
    const navigation = expectedNavigation(filePath);
    if (lines[1] !== "" || lines[2] !== navigation || lines[3] !== "") {
      errors.push(`${filePath} must place its canonical language navigation after the title`);
    }
    const actualSections = [...source.matchAll(/^## (.+)$/gmu)].map((match) => match[1].trim());
    if (JSON.stringify(actualSections) !== JSON.stringify(language.sections)) {
      errors.push(`${filePath} must use the configured H2 section order`);
    }
    for (const token of config.requiredTokens) {
      if (!source.includes(token)) {
        errors.push(`${filePath} is missing required README contract token: ${token}`);
      }
    }
    for (const productToken of ["Broken links", "Isolated files"]) {
      if (!source.includes(productToken)) {
        errors.push(`${filePath} is missing required product term: ${productToken}`);
      }
    }
    if (/Orphan files|孤儿文件/iu.test(source)) {
      errors.push(`${filePath} contains retired orphan-file terminology`);
    }
    validateTargets(projectRoot, filePath, source, errors);
  }

  const allowed = new Set(translatedReadmes);
  for (const readmePath of listLocalizedReadmes(projectRoot, projectRoot).sort()) {
    if (!allowed.has(readmePath)) {
      errors.push(`Localized README is outside the configured layout: ${readmePath}`);
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const errors = checkReadmeI18n();
  if (errors.length > 0) {
    console.error("README i18n contract failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`README i18n contract passed: ${config.languages.length} public README files.`);
  }
}
