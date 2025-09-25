const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

async function parseSsauSchedule(url) {
    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                          'Chrome/58.0.3029.110 Safari/537.3'
        };
        const response = await axios.get(url, { headers, timeout: 30000 });
        if (response.status !== 200) {
            console.error('Ошибка при загрузке страницы, статус:', response.status);
            return [];
        }

        const $ = cheerio.load(response.data);
        const divContainerTimetable = $('body').find('div.container.timetable');
        if (!divContainerTimetable.length) {
            console.warn("Не найден контейнер timetable");
            return [];
        }

        const divCard = divContainerTimetable.find('div.card-default.timetable-card');
        const divSchedule = divCard.find('div.schedule');
        const divScheduleItems = divSchedule.find('div.schedule__items');
        if (!divScheduleItems.length) {
            console.warn("Не найден блок schedule__items");
            return [];
        }

        const allDivScheduleItems = divScheduleItems.find('div.schedule__item, div.schedule__item.schedule__item_show');
        const scheduleData = [];

        allDivScheduleItems.each((_, item) => {
            const lessonsInfo = [];
            const $item = $(item);

            if ($item.find('div.schedule__lesson').length === 0) {
                lessonsInfo.push({ message: 'No lessons on this time' });
                scheduleData.push(lessonsInfo);
                return;
            }

            const lessonDivs = $item.find('div.schedule__lesson');
            lessonDivs.each((_, lesson) => {
                const $lesson = $(lesson);
                const lessonWrapper = $lesson.find('div.schedule__lesson-wrapper');
                if (!lessonWrapper.length) return;

                const lessonInfoDiv = lessonWrapper.find('div.schedule__lesson-info');
                if (!lessonInfoDiv.length) return;

                const discipline = lessonInfoDiv.find('div.body-text.schedule__discipline').text().trim() || null;
                const place = lessonInfoDiv.find('div.caption-text.schedule__place').text().trim() || null;
                const teacher = lessonInfoDiv.find('div.schedule__teacher').text().trim() || null;

                const groupsInfo = [];
                const groupsContainer = lessonInfoDiv.find('div.schedule__groups');

                if (groupsContainer.length) {
                    const spanGroup = groupsContainer.find('span.caption-text');
                    if (spanGroup.length) {
                        groupsInfo.push(spanGroup.text().trim());
                    } else {
                        const groupLinks = groupsContainer.find('a.caption-text.schedule__group');
                        groupLinks.each((_, link) => {
                            const $link = $(link);
                            groupsInfo.push({
                                number: $link.text().trim(),
                                href: $link.attr('href')
                            });
                        });
                    }
                }

                const lessonData = {
                    discipline,
                    place,
                    teacher,
                    groups: groupsInfo
                };
                lessonsInfo.push(lessonData);
            });

            if (lessonsInfo.length === 0) {
                scheduleData.push([{ message: 'No lessons on this time' }]);
            } else {
                scheduleData.push(lessonsInfo);
            }
        });

        return scheduleData;
    } catch (error) {
        console.error("Ошибка при парсинге:", error && error.message ? error.message : error);
        return [];
    }
}

function cleanSchedule(data, removeCount = 7) {
    const cleaned = [];
    let removed = 0;
    for (const item of data) {
        let containsNoLessons = false;
        if (Array.isArray(item)) {
            for (const elem of item) {
                if (typeof elem === 'object' && elem.message === 'No lessons on this time') {
                    containsNoLessons = true;
                    break;
                }
            }
        }
        if (containsNoLessons && removed < removeCount) {
            removed++;
            continue;
        }
        cleaned.push(item);
    }
    console.log(`Удалено ${removed} пустых записей`);
    return cleaned;
}

function sha1hex(s) {
    return crypto.createHash('sha1').update(s).digest('hex');
}
function sanitizeFilePart(s) {
    return String(s || '').replace(/[^0-9a-zA-Z-_]/g, '_').slice(0, 64);
}

(async () => {
    try {
        const args = process.argv.slice(2);
        if (!args.length) {
            console.error('Usage examples:\n node lessons_parse.js <groupId> <week>\n node lessons_parse.js staff:<staffId> <week>\n node lessons_parse.js "<fullUrl>"');
            process.exit(2);
        }

        // default values
        let targetUrl = null;
        let groupId = null;
        let staffId = null;
        let weekNumber = null;

        // 1) arg like staff:123  week
        if (args[0].startsWith('staff:')) {
            staffId = args[0].slice('staff:'.length);
            weekNumber = args[1] || '1';
            targetUrl = `https://ssau.ru/rasp?staffId=${encodeURIComponent(staffId)}&selectedWeek=${encodeURIComponent(weekNumber)}`;
        }
        // 2) arg like group:123  week
        else if (args[0].startsWith('group:')) {
            groupId = args[0].slice('group:'.length);
            weekNumber = args[1] || '1';
            targetUrl = `https://ssau.ru/rasp?groupId=${encodeURIComponent(groupId)}&selectedWeek=${encodeURIComponent(weekNumber)}`;
        }
        // 3) one arg is full URL
        else if (args.length === 1 && /^https?:\/\//i.test(args[0])) {
            targetUrl = args[0];
        }
        // 4) two args: treat as groupId week (backwards compatible)
        else if (args.length >= 2) {
            groupId = args[0];
            weekNumber = args[1];
            targetUrl = `https://ssau.ru/rasp?groupId=${encodeURIComponent(groupId)}&selectedWeek=${encodeURIComponent(weekNumber)}`;
        } else {
            // fallback: join args into url (if user passed unquoted url parts)
            targetUrl = args.join(' ');
        }

        // Проверяем URL
        let parsed;
        try {
            parsed = new URL(targetUrl);
        } catch (e) {
            console.error('Invalid URL generated:', targetUrl);
            process.exit(2);
        }

        if (!parsed.host.includes('ssau.ru')) {
            console.error('Host must be ssau.ru, got:', parsed.host);
            process.exit(2);
        }

        // если в url есть параметры, извлечём их (переопределение groupId/week/staffId)
        if (parsed.searchParams.has('groupId')) groupId = parsed.searchParams.get('groupId');
        if (parsed.searchParams.has('selectedWeek')) weekNumber = parsed.searchParams.get('selectedWeek');
        if (parsed.searchParams.has('staffId')) staffId = parsed.searchParams.get('staffId');

        console.log('Парсинг URL:', targetUrl);
        const parsedData = await parseSsauSchedule(targetUrl);
        const cleaned = cleanSchedule(parsedData, 7);

        const baseDir = __dirname;
        const dataDir = path.join(baseDir, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

        let specificName;
        if (groupId && weekNumber) {
            specificName = `schedule_group_${sanitizeFilePart(groupId)}_${sanitizeFilePart(weekNumber)}.json`;
        } else if (staffId && weekNumber) {
            specificName = `schedule_staff_${sanitizeFilePart(staffId)}_${sanitizeFilePart(weekNumber)}.json`;
        } else if (groupId && !weekNumber) {
            specificName = `schedule_group_${sanitizeFilePart(groupId)}.json`;
        } else if (staffId && !weekNumber) {
            specificName = `schedule_staff_${sanitizeFilePart(staffId)}.json`;
        } else {
            specificName = `schedule_url_${sha1hex(targetUrl)}.json`;
        }

        const outSpecific = path.join(dataDir, specificName);
        const outGeneric = path.join(dataDir, 'schedule.json');

        fs.writeFileSync(outSpecific, JSON.stringify(cleaned, null, 4), 'utf8');
        fs.writeFileSync(outGeneric, JSON.stringify(cleaned, null, 4), 'utf8');

        console.log('Записаны файлы:');
        console.log(' - specific:', outSpecific);
        console.log(' - generic:', outGeneric);

        process.exit(0);
    } catch (err) {
        console.error('Fatal parser error:', err && err.stack ? err.stack : err);
        process.exit(2);
    }
})();
