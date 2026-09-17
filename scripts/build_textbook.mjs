// Renders docs/textbook/*.md -> public/data/textbook.json (chapters as HTML fragments)
// so the /textbook/ ebook viewer can ship without a JS markdown dependency.
// Usage: node scripts/build_textbook.mjs [--pdf] (pandoc; tectonic for PDF)
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DIR = 'docs/textbook';
const PARTS = [
  { name: 'Foundations', slugs: ['01-introduction', '02-data-and-ir', '03-generic-structures', '04-circuits-tour'] },
  { name: 'The Method', slugs: ['05-operators', '06-ensemble-method'] },
  { name: 'Three Circuits', slugs: ['07-heading-lab', '08-field-model', '09-cross-validation', '10-phasor-circuit', '11-mushroom-body'] },
  { name: 'Assessment', slugs: ['12-benchmark', '13-compiler', '14-embodied', '15-synthesis'] },
  { name: 'Beyond the Fly', slugs: ['16-upload'] },
  { name: 'Appendices', slugs: ['A-reproduction', 'B-references'] },
];

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.md')).sort();
const bySlug = {};
for (const f of files) {
  let md = fs.readFileSync(path.join(DIR, f), 'utf8');
  md = md.replace(/^---[\s\S]*?---\n/, '');          // strip YAML front matter
  md = md.replace(/\\(?:newpage|tableofcontents|frontmatter|mainmatter|appendix)\b/g, '');
  const html = execFileSync('pandoc', ['-f', 'markdown', '-t', 'html', '--mathml', '--wrap=none'], { input: md }).toString();
  const title = (md.match(/^#\s+(.+)$/m) || [null, f.replace(/\.md$/, '')])[1].trim();
  bySlug[f.replace(/\.md$/, '')] = { slug: f.replace(/\.md$/, ''), title, html };
}
const parts = PARTS.map(p => ({ name: p.name, chapters: p.slugs.filter(s => bySlug[s]) }));
const chapters = parts.flatMap((p, pi) => p.chapters.map(s => ({ ...bySlug[s], part: p.name, partIndex: pi })));
fs.writeFileSync('public/data/textbook.json', JSON.stringify({ parts, chapters }));
console.log(`textbook.json: ${chapters.length} chapters in ${parts.length} parts`);

if (process.argv.includes('--pdf')) {
  const output = path.join(DIR, 'fly-brain-textbook.pdf');
  const sources = ['00-title', ...chapters.map(c => c.slug)].map(s => path.join(DIR, `${s}.md`));
  execFileSync('pandoc', [
    ...sources, '-o', output, '--pdf-engine=tectonic',
    '--top-level-division=chapter', '--number-sections', '--toc', '--toc-depth=1',
    '-V', 'documentclass=book', '-V', 'classoption=openany',
    '-V', 'fontsize=11pt', '-V', 'mainfont=STIX Two Text',
    '-V', 'geometry:paperwidth=6.5in,paperheight=9.5in,margin=0.75in',
    '-V', 'colorlinks=true', '-V', 'linkcolor=black', '-V', 'urlcolor=blue',
    '--include-in-header', path.join(DIR, 'pdf-header.tex'),
  ], { stdio: 'inherit' });
  fs.copyFileSync(output, 'public/fly-brain-textbook.pdf');
  console.log('PDF built and copied to the reader download.');
}
