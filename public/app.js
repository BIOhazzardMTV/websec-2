// public/app.js
(() => {
    const TIMES = [
        "08:00 - 09:35",
        "09:45 - 11:20",
        "11:30 - 13:05",
        "13:30 - 15:05",
        "15:15 - 16:50",
        "17:00 - 18:35",
        "18:45 - 20:15",
        "20:25 - 21:55"
    ];
    const DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

    const searchInput = document.getElementById('searchInput');
    const suggestionsBox = document.getElementById('suggestions');
    const weekInput = document.getElementById('weekInput');
    const applyWeekBtn = document.getElementById('applyWeekBtn');
    const selectedLabel = document.getElementById('selectedLabel');
    const currentWeekInfo = document.getElementById('currentWeekInfo');
    const timetable = document.getElementById('timetable');
    const modeRadios = document.getElementsByName('mode');

    let groups = [];
    let staff = [];
    let mode = 'group';
    let selected = null;
    let selectedWeek = determineAcademicWeek();

    async function init() {
        await loadDictionaries();
        weekInput.value = selectedWeek;
        currentWeekInfo.textContent = `Определена учебная неделя № ${selectedWeek} (рассчитано от 1 сентября).`;
        renderEmptyTable();
        attachListeners();
    }

    async function loadDictionaries() {
        try {
            const [gResp, sResp] = await Promise.all([fetch('/api/groups'), fetch('/api/staff')]);
            if (!gResp.ok || !sResp.ok) throw new Error('Ошибка загрузки справочников');
            groups = await gResp.json();
            staff = await sResp.json();
        } catch (err) {
            console.error(err);
            console.log('Не удалось загрузить справочники. Убедитесь, что сервер запущен и в папке data есть groups.json и staff.json.');
        }
    }

    function attachListeners() {
        let debounceTimer = null;
        searchInput.addEventListener('input', (e) => {
            const q = e.target.value.trim();
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => showSuggestions(q), 200);
        });

        document.addEventListener('click', (e) => {
            if (!suggestionsBox.contains(e.target) && e.target !== searchInput) {
                suggestionsBox.style.display = 'none';
            }
        });

        applyWeekBtn.addEventListener('click', () => {
            selectedWeek = parseInt(weekInput.value, 10) || selectedWeek;
            currentWeekInfo.textContent = `Просмотр недели № ${selectedWeek}.`;
            if (selected) loadAndRenderSchedule();
        });

        modeRadios.forEach(r => r.addEventListener('change', () => {
            mode = document.querySelector('input[name="mode"]:checked').value;
            selected = null;
            selectedLabel.textContent = '—';
            renderEmptyTable();
        }));
    }

    async function showSuggestions(q) {
        if (!q) {
            suggestionsBox.style.display = 'none';
            return;
        }
        try {
            const url = '/api/search?q=' + encodeURIComponent(q);
            const resp = await fetch(url);
            const data = await resp.json();
            suggestionsBox.innerHTML = '';
            const items = [];
            if (data.groups && data.groups.length) data.groups.forEach(g => items.push({ type: 'group', id: g.id, label: g.number }));
            if (data.staff && data.staff.length) data.staff.forEach(s => items.push({ type: 'staff', id: s.id, label: s.name }));
            if (items.length === 0) { suggestionsBox.style.display = 'none'; return; }
            items.slice(0,40).forEach(it => {
                const div = document.createElement('div');
                div.className = 'suggestion';
                div.textContent = it.label + (it.type === 'group' ? ' — группа' : ' — преподаватель');
                div.addEventListener('click', () => onSelectSuggestion(it));
                suggestionsBox.appendChild(div);
            });
            suggestionsBox.style.display = 'block';
        } catch (err) {
            console.error('search error', err);
        }
    }

    function onSelectSuggestion(it) {
        selected = { type: it.type === 'group' ? 'group' : 'staff', id: it.id, display: it.label };
        selectedLabel.textContent = `${it.label} (${it.type})`;
        suggestionsBox.style.display = 'none';
        searchInput.value = it.label;
        loadAndRenderSchedule();
    }

    async function loadAndRenderSchedule() {
        renderEmptyTable('Загрузка расписания...');

        if (!selected) {
            renderEmptyTable('Сначала выберите группу или преподавателя');
            return;
        }

        try {
            await refreshScheduleOnServer(selected.id, selectedWeek, selected.type);
        } catch (err) {
            console.error('Refresh error', err);
            renderEmptyTable('Ошибка обновления расписания: ' + (err && err.message ? err.message : err));
            return;
        }

        let url = '/api/schedule?';
        if (selected.type === 'group') {
            url += 'groupId=' + encodeURIComponent(selected.id) + '&week=' + encodeURIComponent(selectedWeek);
        } else if (selected.type === 'staff') {
            url += 'staffId=' + encodeURIComponent(selected.id) + '&week=' + encodeURIComponent(selectedWeek);
        }

        try {
            const resp = await fetch(url);
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ error: resp.statusText }));
                renderEmptyTable('Ошибка загрузки расписания: ' + (err.error || resp.statusText));
                return;
            }
            const j = await resp.json();
            const schedule = j.data;

            if (!Array.isArray(schedule)) {
                renderEmptyTable('Некорректный формат schedule.json');
                return;
            }

            const matrix = transformToMatrix(schedule);
            renderTable(matrix);
        } catch (err) {
            console.error(err);
            renderEmptyTable('Ошибка загрузки расписания');
        }
    }

    // Вызов сервера, который стартует lessons_parse.js и ждёт результата
    async function refreshScheduleOnServer(id, week, type = "group") {
        let url;
        if (type === "group") {
            url = `/api/refresh-schedule?groupId=${encodeURIComponent(id)}&week=${encodeURIComponent(week)}`;
        } else if (type === "staff") {
            url = `/api/refresh-schedule?staffId=${encodeURIComponent(id)}&week=${encodeURIComponent(week)}`;
        } else {
            throw new Error("Unknown type: " + type);
        }

        const resp = await fetch(url, { method: 'POST' });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: resp.statusText }));
            throw new Error(err.error || 'Server error');
        }
        const j = await resp.json();
        if (!j || !j.ok) {
            throw new Error(j && j.error ? j.error : 'Parser error');
        }
        return j;
    }

    function transformToMatrix(schedule) {
        const cells = schedule.slice();
        const matrix = [];
        const slots = TIMES.length;
        const days = DAYS.length;
        const totalNeeded = slots * days;
        while (cells.length < totalNeeded) cells.push([{ message: 'No lessons on this time' }]);
        for (let r = 0; r < slots; r++) {
            const row = [];
            for (let d = 0; d < days; d++) {
                const idx = r * days + d;
                const cell = cells[idx];
                if (!Array.isArray(cell)) row.push([]);
                else {
                    const filtered = cell.filter(x => !(x && x.message === 'No lessons on this time'));
                    row.push(filtered);
                }
            }
            matrix.push(row);
        }
        return matrix;
    }

    function renderEmptyTable(message = 'Пусто') {
        timetable.innerHTML = '';
        const caption = document.createElement('caption');
        caption.textContent = message;
        timetable.appendChild(caption);
    }

    function renderTable(matrix) {
        timetable.innerHTML = '';
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const emptyTh = document.createElement('th');
        emptyTh.className = 'time-col-head';
        emptyTh.textContent = '';
        headerRow.appendChild(emptyTh);

        const weekStart = academicWeekStartDate(selectedWeek);
        for (let d = 0; d < DAYS.length; d++) {
            const th = document.createElement('th');
            const date = new Date(weekStart);
            date.setDate(date.getDate() + d);
            const dd = date.getDate();
            const mm = date.getMonth() + 1;
            th.innerHTML = `<div class="day-name">${DAYS[d]}</div><div class="day-date">${dd}.${String(mm).padStart(2,'0')}</div>`;
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        timetable.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (let r = 0; r < TIMES.length; r++) {
            const tr = document.createElement('tr');
            const timeTd = document.createElement('td');
            timeTd.className = 'time-col';
            timeTd.textContent = TIMES[r];
            tr.appendChild(timeTd);

            for (let d = 0; d < DAYS.length; d++) {
                const td = document.createElement('td');
                const cell = matrix[r][d] || [];
                if (!cell || cell.length === 0) {
                    td.className = 'empty';
                    td.textContent = '';
                } else {
                    cell.forEach(lesson => {
                        const block = document.createElement('div');
                        block.className = 'lesson-block';
                        const title = lesson.discipline || lesson.message || '';
                        const teacher = lesson.teacher || '';
                        const place = lesson.place || '';
                        block.innerHTML = `<div class="lesson-title">${escapeHtml(title)}</div>
                                           <div class="lesson-meta">${escapeHtml(teacher)} ${escapeHtml(place ? ('• ' + place) : '')}</div>`;
                        if (Array.isArray(lesson.groups) && lesson.groups.length) {
                            const gwrap = document.createElement('div');
                            gwrap.className = 'lesson-groups';
                            lesson.groups.forEach(g => {
                                if (typeof g === 'string') {
                                    const span = document.createElement('span');
                                    span.textContent = g;
                                    gwrap.appendChild(span);
                                } else if (g && g.number) {
                                    const a = document.createElement('a');
                                    a.href = g.href || '#';
                                    a.textContent = g.number;
                                    a.className = 'group-link';
                                    gwrap.appendChild(a);
                                }
                            });
                            block.appendChild(gwrap);
                        }
                        td.appendChild(block);
                    });
                }
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        timetable.appendChild(tbody);
    }

    function determineAcademicWeek(date = new Date()) {
        const year = date.getFullYear();
        const septThisYear = new Date(year, 8, 1);
        let base;
        if (date >= septThisYear) base = septThisYear;
        else base = new Date(year - 1, 8, 1);
        const days = Math.floor((date - base) / (24 * 3600 * 1000));
        return Math.floor(days / 7) + 1;
    }

    function academicWeekStartDate(weekNumber) {
        const now = new Date();
        const year = now.getFullYear();
        const septThisYear = new Date(now >= new Date(year,8,1) ? year : year - 1, 8, 1);
        const start = new Date(septThisYear);
        start.setDate(start.getDate() + (weekNumber - 1) * 7);
        const day = start.getDay();
        const delta = day === 0 ? -6 : (1 - day);
        start.setDate(start.getDate() + delta);
        return start;
    }

    function escapeHtml(s) {
        if (!s) return '';
        return s.replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
    }

    init();
    window.__timetable_tools = { determineAcademicWeek, academicWeekStartDate };
})();
