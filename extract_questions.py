import fitz
import json
import re
from pathlib import Path

PDF_PATH = Path('book/9000 Clues 4500 Words - The Ultimate Word Power Hack for the SAT, ACT, GMAT, and GRE Vocabulary.pdf')
OUTPUT_PATH = Path('banks/questions.json')
START_PAGE = 249  # zero-based page index for PDF page 250

re_solution_header = re.compile(r'^Solutions:\s*Chapter\s*(\d+)', re.I)
re_question_start = re.compile(r'^(\d+)\.(?:\s*)(.*)$')
re_option_line = re.compile(r'^([A-E])\.\s*(.*)$', re.I)
re_answer_line = re.compile(r'^Answer:\s*(.*)$', re.I)
re_stars = re.compile(r'\*(.*?)\*')


def normalize_text(text: str) -> str:
    text = text.strip()
    text = re_stars.sub(lambda m: m.group(1), text)
    return text


def find_correct_label(answer_text: str, options: list) -> str | None:
    answer_text_norm = answer_text.strip().lower()
    answer_text_norm = re.sub(r'[^\w\s]', '', answer_text_norm)

    for opt in options:
        opt_text_norm = re.sub(r'[^\w\s]', '', opt['text'].strip().lower())
        if answer_text_norm == opt_text_norm:
            return opt['label']

    for opt in options:
        opt_text_norm = re.sub(r'[^\w\s]', '', opt['text'].strip().lower())
        if answer_text_norm in opt_text_norm or opt_text_norm in answer_text_norm:
            return opt['label']

    answer_words = answer_text_norm.split()
    for opt in options:
        opt_text_norm = re.sub(r'[^\w\s]', '', opt['text'].strip().lower())
        if all(word in opt_text_norm for word in answer_words):
            return opt['label']

    return None


def parse_solution_pages(doc):
    chapter = None
    question = None
    questions = []

    def finalize_question():
        nonlocal question
        if not question:
            return
        question['prompt'] = normalize_text(' '.join(question['prompt_lines']))
        question.pop('prompt_lines', None)
        if question['answer_text'] is not None:
            question['correctLabel'] = find_correct_label(question['answer_text'], question['options'])
        else:
            question['correctLabel'] = None
        questions.append(question)
        question = None

    for page_num in range(START_PAGE, len(doc)):
        page = doc[page_num]
        text = page.get_text('text')
        lines = [line.strip() for line in text.splitlines()]

        for line in lines:
            if not line:
                continue

            header_match = re_solution_header.match(line)
            if header_match:
                chapter = int(header_match.group(1))
                continue

            q_match = re_question_start.match(line)
            if q_match:
                finalize_question()
                question = {
                    'chapter': chapter,
                    'number': int(q_match.group(1)),
                    'prompt_lines': [q_match.group(2).strip()],
                    'options': [],
                    'answer_text': None,
                    'source_page': page_num + 1,
                }
                continue

            if question is None:
                continue

            opt_match = re_option_line.match(line)
            if opt_match:
                label = opt_match.group(1).upper()
                text_value = normalize_text(opt_match.group(2))
                question['options'].append({'label': label, 'text': text_value})
                continue

            ans_match = re_answer_line.match(line)
            if ans_match:
                question['answer_text'] = normalize_text(ans_match.group(1))
                continue

            if question['options'] and question['answer_text'] is None:
                question['answer_text'] = normalize_text(line)
                continue

            if question['options']:
                continue

            question['prompt_lines'].append(line)

    finalize_question()
    return questions


def main():
    if not PDF_PATH.exists():
        raise FileNotFoundError(f'PDF not found at {PDF_PATH}')

    doc = fitz.open(PDF_PATH)
    questions = parse_solution_pages(doc)

    print(f'Parsed {len(questions)} question entries from pages {START_PAGE+1} onward.')
    missing_labels = [q for q in questions if q['correctLabel'] is None]
    print(f'Questions missing label mapping: {len(missing_labels)}')
    if missing_labels:
        for q in missing_labels[:10]:
            print(f"chapter={q['chapter']} number={q['number']} answer='{q['answer_text']}' options={[o['text'] for o in q['options']]}")

    with OUTPUT_PATH.open('w', encoding='utf-8') as f:
        json.dump(questions, f, indent=2, ensure_ascii=False)
    print(f'Wrote {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
