import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GitHubApiService } from '../../core';
import { PullRequest, WorkflowArtifact } from '../../models';

const ARTIFACT_NAME = 'coverage_html_report';

export interface CoverageFileSummary {
  /** File path as shown in the report. */
  name: string;
  /** Coverage percentage 0-100, or null if not parsed. */
  coverage: number | null;
  /** Number of missing/uncovered lines, or null if not parsed. */
  missing: number | null;
}

export interface CoverageReport {
  /** Self-contained HTML (assets inlined) suitable for an iframe srcdoc. */
  html: string;
  /** Raw index.html content for download. */
  rawHtml: string;
  /** Overall coverage percentage, or null if not parsed. */
  totalCoverage: number | null;
  /** Per-file summary parsed from the report (best effort, may be empty). */
  files: CoverageFileSummary[];
}

interface ExtractedFile {
  path: string;
  base64: string;
}

@Injectable({ providedIn: 'root' })
export class CoverageService {
  private readonly api = inject(GitHubApiService);

  isAvailable(): boolean {
    return !!(window as any).electronAPI?.downloadCoverageArtifact;
  }

  /**
   * Find the coverage_html_report artifact matching the PR's head SHA.
   * Falls back to the most recent matching artifact if no exact SHA match.
   */
  async findArtifact(pr: PullRequest): Promise<WorkflowArtifact | null> {
    const owner = pr.base.repo.owner.login;
    const repo = pr.base.repo.name;

    const result = await firstValueFrom(this.api.listArtifacts(owner, repo, ARTIFACT_NAME));
    const candidates = result.artifacts.filter((a) => !a.expired);
    if (candidates.length === 0) return null;

    const headMatch = candidates.find((a) => a.workflow_run?.head_sha === pr.head.sha);
    if (headMatch) return headMatch;

    // Fall back to the newest artifact for this PR.
    return [...candidates].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];
  }

  /**
   * Download and build a renderable coverage report for the given PR.
   * Returns null when no artifact is available.
   */
  async loadReport(pr: PullRequest): Promise<CoverageReport | null> {
    const artifact = await this.findArtifact(pr);
    if (!artifact) return null;

    const owner = pr.base.repo.owner.login;
    const repo = pr.base.repo.name;

    const electronAPI = (window as any).electronAPI;
    const response: { success: boolean; files?: ExtractedFile[]; error?: string } =
      await electronAPI.downloadCoverageArtifact({ owner, repo, artifactId: artifact.id });

    if (!response.success || !response.files) {
      throw new Error(response.error || 'Failed to download coverage report');
    }

    return this.buildReport(response.files);
  }

  private buildReport(files: ExtractedFile[]): CoverageReport {
    const decoded = new Map<string, Uint8Array>();
    for (const f of files) {
      decoded.set(f.path, this.base64ToBytes(f.base64));
    }

    const indexPath = this.findIndexPath(files.map((f) => f.path));
    if (!indexPath) {
      throw new Error('No index.html found in coverage report');
    }

    const rawHtml = this.bytesToText(decoded.get(indexPath)!);
    const baseDir = indexPath.includes('/')
      ? indexPath.slice(0, indexPath.lastIndexOf('/') + 1)
      : '';
    const html = this.inlineAssets(rawHtml, baseDir, decoded);

    return {
      html,
      rawHtml,
      totalCoverage: this.parseTotalCoverage(rawHtml),
      files: this.parseFiles(rawHtml),
    };
  }

  /** Prefer a top-level index.html, otherwise the shallowest one available. */
  private findIndexPath(paths: string[]): string | null {
    const indexes = paths.filter((p) => p.toLowerCase().endsWith('index.html'));
    if (indexes.length === 0) return null;
    return indexes.sort((a, b) => a.split('/').length - b.split('/').length)[0];
  }

  /**
   * Inline stylesheets, scripts and images referenced by the report so it can
   * be rendered from an iframe srcdoc without any further network/file access.
   */
  private inlineAssets(html: string, baseDir: string, files: Map<string, Uint8Array>): string {
    let out = html;

    // <link rel="stylesheet" href="...">  ->  <style>...</style>
    out = out.replace(/<link\b[^>]*>/gi, (tag) => {
      if (/rel\s*=\s*["']?stylesheet/i.test(tag)) {
        const href = this.attr(tag, 'href');
        const content = href ? this.resolve(baseDir, href, files) : null;
        if (content != null) {
          return `<style>\n${this.bytesToText(content)}\n</style>`;
        }
      }
      // Drop favicons / preloads that would 404 inside the sandbox.
      return '';
    });

    // <script src="..."></script>  ->  inline script
    out = out.replace(
      /<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
      (full, _pre, src, _post) => {
        const content = this.resolve(baseDir, src, files);
        if (content != null) {
          return `<script>\n${this.bytesToText(content)}\n</script>`;
        }
        return '';
      },
    );

    // <img src="..."> -> data URI
    out = out.replace(/(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])/gi, (full, pre, src, post) => {
      const content = this.resolve(baseDir, src, files);
      if (content != null) {
        const mime = this.mimeFor(src);
        const b64 = this.bytesToBase64(content);
        return `${pre}data:${mime};base64,${b64}${post}`;
      }
      return full;
    });

    return out;
  }

  private resolve(baseDir: string, ref: string, files: Map<string, Uint8Array>): Uint8Array | null {
    if (/^(https?:|data:|#|\/\/)/i.test(ref)) return null;
    const clean = ref.split('?')[0].split('#')[0].replace(/^\.\//, '');
    const candidates = [baseDir + clean, clean];
    for (const c of candidates) {
      if (files.has(c)) return files.get(c)!;
    }
    // Last resort: match by basename.
    const base = clean.split('/').pop();
    for (const [path, content] of files) {
      if (path.split('/').pop() === base) return content;
    }
    return null;
  }

  private attr(tag: string, name: string): string | null {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
    return m ? m[1] : null;
  }

  private mimeFor(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'gif':
        return 'image/gif';
      case 'svg':
        return 'image/svg+xml';
      case 'ico':
        return 'image/x-icon';
      default:
        return 'application/octet-stream';
    }
  }

  /** Best-effort overall coverage extraction across common report formats. */
  private parseTotalCoverage(html: string): number | null {
    // coverage.py: <span class="pc_cov">87%</span>
    const pcCov = html.match(/class=["']pc_cov["'][^>]*>\s*([\d.]+)\s*%/i);
    if (pcCov) return parseFloat(pcCov[1]);

    // Istanbul: <span class="strong">87.5% </span> inside the summary clearfix
    const istanbul = html.match(/class=["']clearfix["'][\s\S]{0,400}?([\d.]+)%/i);
    if (istanbul) return parseFloat(istanbul[1]);

    return null;
  }

  /** Best-effort per-file summary extraction (coverage.py / Istanbul tables). */
  private parseFiles(html: string): CoverageFileSummary[] {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = Array.from(doc.querySelectorAll('table tbody tr'));
    const files: CoverageFileSummary[] = [];

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 2) continue;

      const name = (cells[0].textContent || '').trim();
      if (!name) continue;

      let coverage: number | null = null;
      let missing: number | null = null;

      for (const cell of cells) {
        const text = (cell.textContent || '').trim();
        const pct = text.match(/^([\d.]+)\s*%$/);
        if (pct && coverage === null) {
          coverage = parseFloat(pct[1]);
        }
      }

      // coverage.py: columns are statements, missing, excluded, coverage.
      // Heuristic: the "missing" cell is a plain integer column.
      const missingCell = cells.find(
        (c) => c.classList.contains('missing') || /\bmis\b|missing/i.test(c.className),
      );
      if (missingCell) {
        const m = (missingCell.textContent || '').trim().match(/(\d+)/);
        if (m) missing = parseInt(m[1], 10);
      }

      files.push({ name, coverage, missing });
    }

    return files;
  }

  private base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  private bytesToText(bytes: Uint8Array): string {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
