export interface CsvError {
  row: number;
  code: string;
  message: string;
}

const HEADERS: Record<string, string[]> = {
  users: ['role', 'email', 'phone', 'display_name_zh', 'display_name_en', 'student_no', 'programme', 'grade_level', 'homeroom_class', 'age_band', 'graduation_year'],
  guardianships: ['parent_email_or_phone', 'student_no', 'relation', 'is_primary'],
  courses: ['year', 'subject_code', 'course_name_zh', 'course_name_en', 'grade_level', 'homeroom_class'],
  teaching: ['teacher_email', 'course_name_zh', 'role'],
  enrollments: ['student_no', 'course_name_zh'],
  mentorships: ['mentor_email', 'student_no', 'type'],
};

export const IMPORT_TYPES = Object.keys(HEADERS);

export function expectedHeaders(type: string): string[] {
  return HEADERS[type] ?? [];
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

export function readTable(type: string, csv: string): { headers: string[]; records: Array<Record<string, string>>; errors: CsvError[] } {
  const table = parseCsv(csv);
  const expected = expectedHeaders(type);
  if (table.length === 0) return { headers: [], records: [], errors: [{ row: 1, code: 'EMPTY', message: '文件是空的' }] };
  const headers = table[0] ?? [];
  if (headers.join(',') !== expected.join(',')) {
    return {
      headers,
      records: [],
      errors: [{ row: 1, code: 'BAD_HEADER', message: `表头应为 ${expected.join(',')}` }],
    };
  }
  const records = table.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    expected.forEach((key, index) => {
      record[key] = cells[index] ?? '';
    });
    return record;
  });
  return { headers, records, errors: [] };
}
