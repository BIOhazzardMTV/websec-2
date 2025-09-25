import requests
from bs4 import BeautifulSoup
import json
import time

def parse_staff_pages(base_url, start_page=1, end_page=129):
    staff_dict = {}
    
    for page_num in range(start_page, end_page + 1):
        url = f"{base_url}?page={page_num}"
        print(f"Обрабатывается страница {page_num}...")
        
        try:
            response = requests.get(url)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
            
            container = soup.select_one('div.container:not([class*=" "])')
            if container is None:
                print(f"  На странице {page_num} не найден контейнер 'container'. Пропускаем.")
                continue

            all_rows = container.find_all('div', class_='row')
            if len(all_rows) < 2:
                print(f"  На странице {page_num} не найден второй блок 'row'. Пропускаем.")
                continue
            second_row = all_rows[1]
            
            target_col = second_row.find('div', class_='col-12 col-md-8 order-2 order-md-1')
            if target_col is None:
                print(f"  На странице {page_num} не найден целевой столбец. Пропускаем.")
                continue
                
            staff_list = target_col.find('ul', class_='list-group')
            if staff_list is None:
                print(f"  На странице {page_num} не найден список преподавателей.")
                continue
            
            list_items = staff_list.find_all('li', class_='list-group-item list-group-item-action')
            
            for item in list_items:
                link_tag = item.find('a', href=True)
                if link_tag:
                    staff_url = link_tag['href']
                    staff_name = link_tag.get_text(strip=True)
                    staff_id = staff_url.split('/')[-1]
                    
                    if staff_id and staff_name:
                        staff_dict[staff_id] = staff_name
            
            print(f"  Страница {page_num} обработана. Найдено преподавателей: {len(list_items)}")
            time.sleep(1)
            
        except requests.exceptions.RequestException as e:
            print(f"Ошибка при загрузке страницы {page_num}: {e}")
        except Exception as e:
            print(f"Неожиданная ошибка при разборе страницы {page_num}: {e}")
    
    return staff_dict

def main():
    base_url = "https://ssau.ru/staff"
    output_filename = "staff.json"
    
    print("Начинается парсинг страниц с преподавателями...")
    staff_data = parse_staff_pages(base_url, 1, 129)
    
    try:
        with open(output_filename, 'w', encoding='utf-8') as f:
            json.dump(staff_data, f, indent=4, ensure_ascii=False)
        print(f"\nГотово! Данные сохранены в файл: {output_filename}")
        print(f"Всего обработано записей: {len(staff_data)}")
    except IOError as e:
        print(f"Ошибка при сохранении файла: {e}")

if __name__ == "__main__":
    main()