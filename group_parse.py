import requests
from bs4 import BeautifulSoup
import json
import time

def get_institute_ids(main_url):
    """Шаг 1: Получает словарь с ID институтов."""
    institutes = {}
    try:
        response = requests.get(main_url)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        institute_links = soup.select('div.faculties div.faculties__item a.h3-text[href]')

        for link in institute_links:
            href = link['href']
            institute_id = href.split('/rasp/faculty/')[-1].split('?')[0]
            institute_name = link.get_text(strip=True)
            if institute_id:
                institutes[institute_id] = institute_name
        print(f"Найдено институтов: {len(institutes)}")
        return institutes

    except requests.exceptions.RequestException as e:
        print(f"Ошибка при получении списка институтов: {e}")
        return {}

def get_group_ids_for_institute(institute_id, base_url):
    """Шаг 2: Получает словарь групп (id: номер) для одного института."""
    groups_dict = {}
    for course in range(1, 7):
        url = f"{base_url}/faculty/{institute_id}?course={course}"
        try:
            response = requests.get(url)
            if response.status_code == 404:
                print(f"  Курс {course} не существует, переход к следующему.")
                break
            response.raise_for_status()

            soup = BeautifulSoup(response.text, 'html.parser')
            group_links = soup.select('a.btn-text.group-catalog__group[href]')

            for link in group_links:
                href = link['href']
                group_id = href.split('groupId=')[-1]
                group_number = link.find('span')
                if group_number:
                    group_number = group_number.get_text(strip=True)
                else:
                    group_number = 'Номер не найден'

                if group_id and group_number:
                    groups_dict[group_id] = group_number

            print(f"  Обработан курс {course}. Найдено групп: {len(group_links)}")
            time.sleep(0.5)

        except requests.exceptions.RequestException as e:
            print(f"Ошибка при парсинге курса {course} для института {institute_id}: {e}")
            continue

    return groups_dict

def main():
    base_url = "https://ssau.ru/rasp"
    all_groups = {}

    institutes = get_institute_ids(base_url)

    if not institutes:
        print("Не удалось получить список институтов. Завершение работы.")
        return

    for i, (institute_id, institute_name) in enumerate(institutes.items(), 1):
        print(f"[{i}/{len(institutes)}] Парсинг групп для института '{institute_name}' (ID: {institute_id})...")
        institute_groups = get_group_ids_for_institute(institute_id, base_url)
        all_groups.update(institute_groups)
        print(f"  Всего групп собрано: {len(institute_groups)}")
        time.sleep(1)

    output_filename = "groups.json"
    try:
        with open(output_filename, 'w', encoding='utf-8') as f:
            json.dump(all_groups, f, indent=4, ensure_ascii=False)
        print(f"\nГотово! Результат сохранен в файл: {output_filename}")
        print(f"Всего собрано пар: {len(all_groups)}")
    except IOError as e:
        print(f"Ошибка при сохранении файла: {e}")

if __name__ == "__main__":
    main()