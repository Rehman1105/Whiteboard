const params = new URLSearchParams(window.location.search);
const mode = params.get("mode");

// Hide toolbar in board mode
if (mode === "board") {
    document.getElementById("toolbar").style.display = "none";
}

// Apply editor-specific styles - Match the view-only board proportions exactly
if (mode === "editor") {
    const style = document.createElement('style');
    style.textContent = `
        body {
            overflow: hidden;
        }
        
        #toolbar {
            flex-shrink: 0;
            height: auto;
        }
        
        .board-container {
            width: 100% !important;
            margin: 0 !important;
            max-width: none !important;
            flex: 1;
        }
        
        .top-bar {
            height: 60px !important;
        }
        
        .left-box {
            width: 200px !important;
            min-width: 200px !important;
            flex-shrink: 0;
        }
        
        .bottom-section {
            height: 300px !important;
            flex-shrink: 0;
        }
        
        .square {
            flex: 1 !important;
            min-width: 0;
        }
        
        .room-header {
            height: 50px !important;
            flex-shrink: 0;
        }
    `;
    document.head.appendChild(style);
}

// Fallback for window.api if not defined (browser mode)
if (!window.api) {
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        // Served from the WebSocket server — connects back to the same host for real-time
        // cross-machine sync.
        const _blockCallbacks = [];
        const _drCallbacks = [];
        const _euthCallbacks = [];
        let _ws = null;

        function _connect() {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            _ws = new WebSocket(`${proto}//${window.location.host}`);

            _ws.onmessage = (event) => {
                let msg;
                try { msg = JSON.parse(event.data); } catch { return; }

                if (msg.type === 'update-block') {
                    _blockCallbacks.forEach(cb => cb({ id: msg.id, data: msg.data }));
                } else if (msg.type === 'dr-initials-changed') {
                    _drCallbacks.forEach(cb => cb(msg.data));
                } else if (msg.type === 'euth-checklist-changed') {
                    _euthCallbacks.forEach(cb => cb(msg.data));
                } else if (msg.type === 'full-state') {
                    if (msg.blocks) {
                        Object.entries(msg.blocks).forEach(([id, data]) => {
                            _blockCallbacks.forEach(cb => cb({ id, data }));
                        });
                    }
                    if (msg.drInitials && Object.keys(msg.drInitials).length > 0) {
                        _drCallbacks.forEach(cb => cb(msg.drInitials));
                    }
                    if (msg.euthChecklist && Object.keys(msg.euthChecklist).length > 0) {
                        _euthCallbacks.forEach(cb => cb(msg.euthChecklist));
                    }
                }
            };

            _ws.onclose = () => setTimeout(_connect, 2000);
        }

        _connect();

        window.api = {
            updateBlock: (data) => {
                if (_ws && _ws.readyState === WebSocket.OPEN) {
                    _ws.send(JSON.stringify({ type: 'update-block', id: data.id, data: data.data }));
                }
            },
            onUpdateBlock: (callback) => { _blockCallbacks.push(callback); },
            updateDrInitials: (data) => {
                if (_ws && _ws.readyState === WebSocket.OPEN) {
                    _ws.send(JSON.stringify({ type: 'dr-initials-changed', data }));
                }
            },
            onDrInitialsChanged: (callback) => { _drCallbacks.push(callback); },
            updateEuthChecklist: (data) => {
                if (_ws && _ws.readyState === WebSocket.OPEN) {
                    _ws.send(JSON.stringify({ type: 'euth-checklist-changed', data }));
                }
            },
            onEuthChecklistChanged: (callback) => { _euthCallbacks.push(callback); }
        };
    } else {
        // Local file mode — use BroadcastChannel (same machine, cross-tab only)
        const _channel = new BroadcastChannel('whiteboard-sync');
        window.api = {
            updateBlock: (data) => { _channel.postMessage(data); },
            onUpdateBlock: (callback) => {
                _channel.addEventListener('message', (event) => callback(event.data));
            },
            updateDrInitials: () => {},
            onDrInitialsChanged: () => {},
            updateEuthChecklist: () => {},
            onEuthChecklistChanged: () => {}
        };
    }
}

const blocks = document.querySelectorAll('.block');

let currentBlock = null;
let currentEditingBox = null;
let isDragging = false;
let isResizing = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let selectedElement = null;
let draggedToolType = null;

let tool = "text";
let currentFontSize = 30;
let currentFontColor = "#000000";

const blockData = {};
const undoStack = {};
const redoStack = {};

// Storage key for saving data
const STORAGE_KEY = "whiteboard-data";
const DR_STORAGE_KEY = "dr-initials-data";
const EUTH_STORAGE_KEY = "euth-checklist-data";

// Coordinates are stored as raw pixels relative to their containing block,
// which is the same size in both editor and board, so no scaling is needed.
function getScaleFactor() {
    return 1;
}

function getInverseScaleFactor() {
    return 1;
}

// Load saved data from localStorage
function loadSavedData() {
    try {
        const savedData = localStorage.getItem(STORAGE_KEY);
        if (savedData) {
            const data = JSON.parse(savedData);
            return data;
        }
    } catch (error) {
        console.error("Error loading saved data:", error);
    }
    return null;
}

// Clean and save data to localStorage
function saveDataToStorage() {
    try {
        const allBlocksData = {};
        blocks.forEach(block => {
            const id = block.dataset.id;
            const textContainer = block.querySelector(".text-container");
            const textBoxes = textContainer.querySelectorAll(".text-box");
            const listContainers = textContainer.querySelectorAll(".list-container");

            const scaleFactor = getScaleFactor();

            const boxData = Array.from(textBoxes)
                .filter(box => box.textContent.trim() !== "")
                .map(box => ({
                    type: "text",
                    text: box.innerHTML,
                    x: parseFloat(box.style.left) * scaleFactor,
                    y: parseFloat(box.style.top) * scaleFactor,
                    width: parseFloat(box.style.width) * scaleFactor,
                    height: parseFloat(box.style.height) * scaleFactor,
                    fontSize: box.style.fontSize,
                    color: box.style.color
                }));

            const listData = Array.from(listContainers)
                .filter(container => {
                    const items = Array.from(container.querySelectorAll(".list-item"));
                    return items.some(item => item.querySelector(".list-label").textContent.trim() !== "");
                })
                .map(container => ({
                    type: "list",
                    items: Array.from(container.querySelectorAll(".list-item"))
                        .filter(item => item.querySelector(".list-label").textContent.trim() !== "")
                        .map(item => ({
                            text: item.querySelector(".list-label").textContent,
                            checked: item.querySelector(".list-checkbox").checked
                        })),
                    x: parseFloat(container.style.left) * scaleFactor,
                    y: parseFloat(container.style.top) * scaleFactor,
                    width: parseFloat(container.style.width) * scaleFactor,
                    height: parseFloat(container.style.height) * scaleFactor,
                    fontSize: container.querySelector(".list-label").style.fontSize,
                    color: container.querySelector(".list-label").style.color
                }));

            allBlocksData[id] = [...boxData, ...listData];
        });

        localStorage.setItem(STORAGE_KEY, JSON.stringify(allBlocksData));
    } catch (error) {
        console.error("Error saving data to storage:", error);
    }
}

// Save and sync Dr. initials
function saveDrInitials() {
    const drInitialsInputs = document.querySelectorAll(".dr-initials");
    const drData = {};
    drInitialsInputs.forEach(input => {
        const id = input.dataset.id || input.id;
        drData[id] = input.value;
        
        // Update display span in real-time if in board mode
        if (mode === "board") {
            const span = input.parentElement.querySelector(".dr-initials-display");
            if (span) {
                span.textContent = input.value;
            }
        }
    });
    localStorage.setItem(DR_STORAGE_KEY, JSON.stringify(drData));
    
    // Broadcast change to other windows/machines
    window.postMessage({ type: "dr-initials-changed", data: drData }, "*");
    if (window.api && window.api.updateDrInitials) {
        window.api.updateDrInitials(drData);
    }
}

// Load Dr. initials
function loadDrInitials() {
    try {
        const savedData = localStorage.getItem(DR_STORAGE_KEY);
        if (savedData) {
            const data = JSON.parse(savedData);
            const drInitialsInputs = document.querySelectorAll(".dr-initials");
            drInitialsInputs.forEach(input => {
                const id = input.dataset.id || input.id;
                if (data[id] !== undefined) {
                    input.value = data[id];
                    
                    // Update display span in board mode
                    if (mode === "board") {
                        const span = input.parentElement.querySelector(".dr-initials-display");
                        if (span) {
                            span.textContent = data[id];
                        }
                    }
                }
            });
        }
    } catch (error) {
        console.error("Error loading dr initials:", error);
    }
}

// Disable Dr. box in view mode
function initDrBoxMode() {
    const drInitialsInputs = document.querySelectorAll(".dr-initials");
    drInitialsInputs.forEach(input => {
        if (mode === "board") {
            input.disabled = true;
            input.style.display = "none";
            // Create a span to show the text value
            const span = document.createElement("span");
            span.className = "dr-initials-display";
            span.textContent = input.value;
            span.style.fontSize = "16px";
            span.style.fontWeight = "bold";
            input.parentElement.appendChild(span);
        } else {
            input.disabled = false;
            input.style.display = "block";
            // Remove any existing display spans in editor mode
            const existingSpan = input.parentElement.querySelector(".dr-initials-display");
            if (existingSpan) {
                existingSpan.remove();
            }
        }
    });
}

// Save euthanasia checklist state
function saveEuthChecklist() {
    const data = {};
    document.querySelectorAll(".euth-check").forEach(cb => {
        data[cb.id] = cb.checked;
    });
    localStorage.setItem(EUTH_STORAGE_KEY, JSON.stringify(data));
    window.postMessage({ type: "euth-checklist-changed", data }, "*");
    if (window.api && window.api.updateEuthChecklist) {
        window.api.updateEuthChecklist(data);
    }
}

// Load euthanasia checklist state
function loadEuthChecklist() {
    try {
        const saved = localStorage.getItem(EUTH_STORAGE_KEY);
        if (saved) {
            const data = JSON.parse(saved);
            document.querySelectorAll(".euth-check").forEach(cb => {
                if (data[cb.id] !== undefined) {
                    cb.checked = data[cb.id];
                }
            });
        }
    } catch (error) {
        console.error("Error loading euthanasia checklist:", error);
    }
}

// Listen for Dr. initials changes from other windows
window.addEventListener("message", (event) => {
    if (event.data.type === "dr-initials-changed") {
        loadDrInitials();
    }
    if (event.data.type === "euth-checklist-changed") {
        loadEuthChecklist();
    }
});

// Listen for block updates from other windows
window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
        const savedData = loadSavedData();
        if (savedData) {
            blocks.forEach(block => {
                const id = block.dataset.id;
                if (savedData[id]) {
                    undoStack[id] = [savedData[id]];
                    redrawBlock(id);
                }
            });
        }
    }
    if (event.key === DR_STORAGE_KEY) {
        loadDrInitials();
    }
    if (event.key === EUTH_STORAGE_KEY) {
        loadEuthChecklist();
    }
});

// Setup toolbar color grid
if (mode === "editor") {
    const toolbarColorBtn = document.getElementById("toolbarColorBtn");
    const toolbarColorGrid = document.querySelector(".toolbar-color-grid");
    
    if (toolbarColorBtn && toolbarColorGrid) {
        let colorGridTimeout;
        
        toolbarColorBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (toolbarColorGrid.style.display === "grid") {
                toolbarColorGrid.style.display = "none";
            } else {
                toolbarColorGrid.style.display = "grid";
            }
        });
        
        toolbarColorBtn.addEventListener("mouseenter", () => {
            clearTimeout(colorGridTimeout);
        });
        
        toolbarColorBtn.addEventListener("mouseleave", () => {
            colorGridTimeout = setTimeout(() => {
                toolbarColorGrid.style.display = "none";
            }, 300);
        });
        
        toolbarColorGrid.addEventListener("mouseenter", () => {
            clearTimeout(colorGridTimeout);
        });
        
        toolbarColorGrid.addEventListener("mouseleave", () => {
            colorGridTimeout = setTimeout(() => {
                toolbarColorGrid.style.display = "none";
            }, 300);
        });
        
        const colorOptions = toolbarColorGrid.querySelectorAll(".color-option");
        colorOptions.forEach(option => {
            option.addEventListener("click", (e) => {
                e.stopPropagation();
                const color = option.getAttribute("title");
                currentFontColor = color;
                
                // Apply color to selected text if there's a selection
                const selection = window.getSelection();
                if (selection.toString()) {
                    const range = selection.getRangeAt(0);
                    const span = document.createElement("span");
                    span.style.color = color;
                    const contents = range.extractContents();
                    span.appendChild(contents);
                    range.insertNode(span);
                    
                    // Save the block after applying color
                    if (currentBlock) {
                        saveBlock(currentBlock);
                        saveDataToStorage();
                    }
                }
                
                toolbarColorGrid.style.display = "none";
            });
        });
    }
}

// Drag and drop from toolbar
if (mode === "editor") {
    const toolbarButtons = document.querySelectorAll('#toolbar [data-tool]');
    toolbarButtons.forEach(button => {
        button.addEventListener('dragstart', (e) => {
            draggedToolType = button.dataset.tool;
            e.dataTransfer.effectAllowed = 'copy';
        });
        
        button.addEventListener('dragend', () => {
            draggedToolType = null;
        });
    });
}

// Setup blocks
blocks.forEach(block => {
    const textContainer = block.querySelector(".text-container");
    const id = block.dataset.id;

    blockData[id] = [];
    undoStack[id] = [];
    redoStack[id] = [];

    if (mode === "editor") {
        block.addEventListener("click", () => {
            blocks.forEach(b => b.classList.remove("active"));
            currentBlock = id;
            block.classList.add("active");
        });

        // Handle drop from toolbar buttons
        textContainer.addEventListener('dragover', (e) => {
            if (draggedToolType) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            }
        });

        textContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            if (draggedToolType) {
                const rect = textContainer.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                if (draggedToolType === 'text') {
                    addTextBox(id, x, y);
                } else if (draggedToolType === 'list') {
                    addListItem(id, x, y);
                }
                draggedToolType = null;
            }
        });

        // Double-click to add a text box or list
        textContainer.addEventListener("dblclick", (e) => {
            if (id !== currentBlock) return;
            e.stopPropagation();

            if (e.target.classList.contains("text-box")) return;
            if (e.target.classList.contains("list-item")) return;
            if (e.target.classList.contains("resize-handle")) return;

            if (tool === "list") {
                addListItem(id, e.offsetX, e.offsetY);
            } else {
                addTextBox(id, e.offsetX, e.offsetY);
            }
        });
    }
});

function addTextBox(id, x, y) {
    const block = document.querySelector(`.block[data-id="${id}"]`);
    const textContainer = block.querySelector(".text-container");

    const textBox = document.createElement("div");
    textBox.className = "text-box editing selected";
    textBox.style.left = x + "px";
    textBox.style.top = y + "px";
    textBox.style.width = "150px";
    textBox.style.height = "60px";
    textBox.style.fontSize = currentFontSize + "px";
    textBox.style.color = currentFontColor;
    textBox.innerHTML = "";

    textContainer.appendChild(textBox);

    createResizeHandles(textBox, block, id);
    makeInteractive(textBox, id);
    selectedElement = textBox;

    // Make editable
    textBox.contentEditable = true;
    textBox.focus();

    textBox.addEventListener("blur", () => {
        textBox.contentEditable = false;
        textBox.classList.remove("editing");
        if (textBox.textContent.trim() === "") {
            // Remove resize handles before removing element
            if (textBox.resizeHandles) {
                Object.values(textBox.resizeHandles).forEach(handle => handle.remove());
            }
            textBox.remove();
            saveDataToStorage();
        } else {
            saveBlock(id);
            saveDataToStorage();
        }
    });
}

function addListItem(id, x, y) {
    const block = document.querySelector(`.block[data-id="${id}"]`);
    const textContainer = block.querySelector(".text-container");

    const listContainer = document.createElement("div");
    listContainer.className = "list-container selected";
    listContainer.style.left = x + "px";
    listContainer.style.top = y + "px";

    const listItem = document.createElement("div");
    listItem.className = "list-item editing";
    listItem.style.fontSize = currentFontSize + "px";
    listItem.style.color = currentFontColor;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "list-checkbox";
    checkbox.addEventListener("change", () => {
        saveBlock(id);
        saveDataToStorage();
    });

    const label = document.createElement("span");
    label.contentEditable = true;
    label.className = "list-label";
    label.textContent = "List item";

    listItem.appendChild(checkbox);
    listItem.appendChild(label);
    listContainer.appendChild(listItem);
    textContainer.appendChild(listContainer);

    createResizeHandles(listContainer, block, id);
    makeInteractive(listContainer, id);
    selectedElement = listContainer;

    label.focus();

    label.addEventListener("blur", () => {
        listItem.classList.remove("editing");
        if (label.textContent.trim() === "") {
            // Remove resize handles before removing element
            if (listContainer.resizeHandles) {
                Object.values(listContainer.resizeHandles).forEach(handle => handle.remove());
            }
            listContainer.remove();
            saveDataToStorage();
        } else {
            saveBlock(id);
            saveDataToStorage();
        }
    });
}

function createResizeHandles(element, block, blockId) {
    const handles = ['tl', 'tr', 'br', 'bl', 't', 'r', 'b', 'l'];
    const resizeHandles = {};
    
    handles.forEach(handle => {
        const resizer = document.createElement('div');
        resizer.className = `resize-handle ${handle}`;
        block.appendChild(resizer);
        resizeHandles[handle] = resizer;
        resizer.style.opacity = '1';
        
        resizer.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            isResizing = true;
            let startX = e.clientX;
            let startY = e.clientY;
            let startWidth = element.offsetWidth;
            let startHeight = element.offsetHeight;
            let startLeft = element.offsetLeft;
            let startTop = element.offsetTop;

            function doResize(e) {
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;

                const container = element.parentElement;
                let newWidth = startWidth;
                let newHeight = startHeight;
                let newLeft = startLeft;
                let newTop = startTop;

                // Calculate new dimensions based on handle
                if (handle.includes('r')) {
                    newWidth = Math.max(50, startWidth + deltaX);
                }
                if (handle.includes('b')) {
                    newHeight = Math.max(30, startHeight + deltaY);
                }
                if (handle.includes('l')) {
                    newLeft = startLeft + deltaX;
                    newWidth = startWidth - deltaX;
                    
                    // Clamp left to 0
                    if (newLeft < 0) {
                        newWidth = startWidth + startLeft;
                        newLeft = 0;
                    }
                    newWidth = Math.max(50, newWidth);
                }
                if (handle.includes('t')) {
                    newTop = startTop + deltaY;
                    newHeight = startHeight - deltaY;
                    
                    // Clamp top to 0
                    if (newTop < 0) {
                        newHeight = startHeight + startTop;
                        newTop = 0;
                    }
                    newHeight = Math.max(30, newHeight);
                }

                // Clamp to right boundary
                if (newLeft + newWidth > container.offsetWidth) {
                    newWidth = container.offsetWidth - newLeft;
                }
                
                // Clamp to bottom boundary
                if (newTop + newHeight > container.offsetHeight) {
                    newHeight = container.offsetHeight - newTop;
                }

                // Ensure minimum dimensions
                newWidth = Math.max(50, newWidth);
                newHeight = Math.max(30, newHeight);

                element.style.width = newWidth + 'px';
                element.style.height = newHeight + 'px';
                element.style.left = newLeft + 'px';
                element.style.top = newTop + 'px';
                
                updateHandlePositions();
            }

            function stopResize() {
                isResizing = false;
                document.removeEventListener('mousemove', doResize);
                document.removeEventListener('mouseup', stopResize);
                saveBlock(blockId);
                saveDataToStorage();
            }

            document.addEventListener('mousemove', doResize);
            document.addEventListener('mouseup', stopResize);
        });
    });
    
    function updateHandlePositions() {
        const rect = element.getBoundingClientRect();
        const blockRect = block.getBoundingClientRect();
        
        resizeHandles.tl.style.top = (rect.top - blockRect.top - 6) + 'px';
        resizeHandles.tl.style.left = (rect.left - blockRect.left - 6) + 'px';
        
        resizeHandles.tr.style.top = (rect.top - blockRect.top - 6) + 'px';
        resizeHandles.tr.style.right = (blockRect.right - rect.right - 6) + 'px';
        
        resizeHandles.br.style.bottom = (blockRect.bottom - rect.bottom - 6) + 'px';
        resizeHandles.br.style.right = (blockRect.right - rect.right - 6) + 'px';
        
        resizeHandles.bl.style.bottom = (blockRect.bottom - rect.bottom - 6) + 'px';
        resizeHandles.bl.style.left = (rect.left - blockRect.left - 6) + 'px';
        
        resizeHandles.t.style.top = (rect.top - blockRect.top - 6) + 'px';
        resizeHandles.t.style.left = (rect.left - blockRect.left + rect.width / 2 - 3) + 'px';
        
        resizeHandles.b.style.bottom = (blockRect.bottom - rect.bottom - 6) + 'px';
        resizeHandles.b.style.left = (rect.left - blockRect.left + rect.width / 2 - 3) + 'px';
        
        resizeHandles.l.style.left = (rect.left - blockRect.left - 6) + 'px';
        resizeHandles.l.style.top = (rect.top - blockRect.top + rect.height / 2 - 3) + 'px';
        
        resizeHandles.r.style.right = (blockRect.right - rect.right - 6) + 'px';
        resizeHandles.r.style.top = (rect.top - blockRect.top + rect.height / 2 - 3) + 'px';
    }
    
    updateHandlePositions();
    element.resizeHandles = resizeHandles;
}

function makeInteractive(element, blockId) {
    makeDraggable(element, blockId);
    
    // Click to select
    element.addEventListener("click", (e) => {
        e.stopPropagation();
        
        // Hide handles on all OTHER boxes first
        const allBoxes = document.querySelectorAll(".text-box.selected, .list-container.selected");
        allBoxes.forEach(box => {
            if (box !== element) {
                box.classList.remove("selected");
                if (box.resizeHandles) {
                    Object.values(box.resizeHandles).forEach(handle => {
                        handle.style.opacity = '0';
                    });
                }
            }
        });
        
        // Now select this element and show its handles
        element.classList.add("selected");
        
        if (element.resizeHandles) {
            // Update handle positions before showing them
            const block = element.closest('.block');
            const rect = element.getBoundingClientRect();
            const blockRect = block.getBoundingClientRect();
            
            element.resizeHandles.tl.style.top = (rect.top - blockRect.top - 6) + 'px';
            element.resizeHandles.tl.style.left = (rect.left - blockRect.left - 6) + 'px';
            element.resizeHandles.tr.style.top = (rect.top - blockRect.top - 6) + 'px';
            element.resizeHandles.tr.style.right = (blockRect.right - rect.right - 6) + 'px';
            element.resizeHandles.br.style.bottom = (blockRect.bottom - rect.bottom - 6) + 'px';
            element.resizeHandles.br.style.right = (blockRect.right - rect.right - 6) + 'px';
            element.resizeHandles.bl.style.bottom = (blockRect.bottom - rect.bottom - 6) + 'px';
            element.resizeHandles.bl.style.left = (rect.left - blockRect.left - 6) + 'px';
            element.resizeHandles.t.style.top = (rect.top - blockRect.top - 6) + 'px';
            element.resizeHandles.t.style.left = (rect.left - blockRect.left + rect.width / 2 - 3) + 'px';
            element.resizeHandles.b.style.bottom = (blockRect.bottom - rect.bottom - 6) + 'px';
            element.resizeHandles.b.style.left = (rect.left - blockRect.left + rect.width / 2 - 3) + 'px';
            element.resizeHandles.l.style.left = (rect.left - blockRect.left - 6) + 'px';
            element.resizeHandles.l.style.top = (rect.top - blockRect.top + rect.height / 2 - 3) + 'px';
            element.resizeHandles.r.style.right = (blockRect.right - rect.right - 6) + 'px';
            element.resizeHandles.r.style.top = (rect.top - blockRect.top + rect.height / 2 - 3) + 'px';
            
            // Now show them
            Object.values(element.resizeHandles).forEach(handle => {
                handle.style.opacity = '1';
            });
        }
        selectedElement = element;
    });

    // Right-click context menu
    element.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e, element, blockId);
    });
}

function deselectAll() {
    const allBoxes = document.querySelectorAll(".text-box.selected, .list-container.selected");
    allBoxes.forEach(box => {
        box.classList.remove("selected");
        if (box.resizeHandles) {
            Object.values(box.resizeHandles).forEach(handle => {
                handle.style.opacity = '0';
            });
        }
    });
}

function showContextMenu(e, element, blockId) {
    const existing = document.querySelector(".context-menu");
    if (existing) existing.remove();

    const selection = window.getSelection();
    let savedRange = null;
    if (selection.toString()) {
        savedRange = selection.getRangeAt(0).cloneRange();
    }

    // Re-enable editing and focus so that sel.addRange() is honored by the browser.
    // Called immediately before restoring savedRange in font-size / color handlers.
    function restoreEditing() {
        if (element.classList.contains("text-box")) {
            element.contentEditable = true;
            element.classList.add("editing");
            element.focus({ preventScroll: true });
        } else if (element.classList.contains("list-container")) {
            const label = element.querySelector(".list-label");
            if (label) {
                label.contentEditable = true;
                label.focus({ preventScroll: true });
            }
        }
    }

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.left = e.clientX + "px";
    menu.style.top = e.clientY + "px";

    // Prevent the menu from stealing focus so the text selection in the text box
    // is not cleared when the user clicks menu items.
    menu.addEventListener("mousedown", (e) => e.preventDefault());

    let menuOpen = true;

    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (element.classList.contains("text-box")) {
            element.contentEditable = true;
            element.classList.add("editing");
            element.focus();
        } else if (element.classList.contains("list-container")) {
            const label = element.querySelector(".list-label");
            if (label) {
                label.contentEditable = true;
                label.focus();
            }
        }
        menuOpen = false;
        menu.remove();
    });

    const fontSizeBtn = document.createElement("button");
    fontSizeBtn.textContent = "Font Size →";
    
    const fontSizeSubmenu = document.createElement("div");
    fontSizeSubmenu.className = "context-submenu";
    fontSizeSubmenu.style.display = "none";
    
    const fontSizes = [10, 12, 14, 16, 18, 20, 24, 28, 32];
    fontSizes.forEach(size => {
        const sizeBtn = document.createElement("button");
        sizeBtn.textContent = size + "px";
        sizeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (savedRange) {
                restoreEditing();
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(savedRange.cloneRange());
                applyFontSize(size);
            }
            saveBlock(blockId);
            saveDataToStorage();
            menuOpen = false;
            menu.remove();
        });
        fontSizeSubmenu.appendChild(sizeBtn);
    });

    let fontSizeOpen = false;
    fontSizeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        fontSizeOpen = !fontSizeOpen;
        fontSizeSubmenu.style.display = fontSizeOpen ? "flex" : "none";
    });

    fontSizeBtn.appendChild(fontSizeSubmenu);

    const colorGrid = document.createElement("div");
    colorGrid.style.position = "absolute";
    colorGrid.style.left = "100%";
    colorGrid.style.top = "-1px";
    colorGrid.style.zIndex = "1001";
    colorGrid.style.pointerEvents = "auto";
    colorGrid.style.gridTemplateColumns = "repeat(4, 1fr)";
    colorGrid.style.gap = "4px";
    colorGrid.style.padding = "8px";
    colorGrid.style.backgroundColor = "white";
    colorGrid.style.border = "1px solid #999";
    colorGrid.style.display = "none";
    
    const colors = [
        "#000000", "#FFFFFF", "#FF0000", "#00FF00",
        "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF",
        "#FFA500", "#800080", "#FFC0CB", "#A52A2A",
        "#808080", "#FFD700", "#008000", "#0000CD"
    ];
    
    colors.forEach(color => {
        const colorOption = document.createElement("div");
        colorOption.style.backgroundColor = color;
        colorOption.style.width = "25px";
        colorOption.style.height = "25px";
        colorOption.style.border = "1px solid #ccc";
        colorOption.style.cursor = "pointer";
        colorOption.style.margin = "2px";
        colorOption.style.pointerEvents = "auto";
        colorOption.title = color;
        
        colorOption.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (savedRange) {
                restoreEditing();
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(savedRange.cloneRange());
                applyFontColor(color);
            }
            saveBlock(blockId);
            saveDataToStorage();
            menuOpen = false;
            menu.remove();
        });
        colorGrid.appendChild(colorOption);
    });

    const colorBtn = document.createElement("button");
    colorBtn.textContent = "Color →";
    
    let colorGridOpen = false;
    colorBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        colorGridOpen = !colorGridOpen;
        colorGrid.style.display = colorGridOpen ? "grid" : "none";
    });

    colorBtn.appendChild(colorGrid);

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (element.resizeHandles) {
            Object.values(element.resizeHandles).forEach(handle => handle.remove());
        }
        element.remove();
        saveDataToStorage();
        menuOpen = false;
        menu.remove();
    });

    menu.appendChild(editBtn);
    menu.appendChild(fontSizeBtn);
    menu.appendChild(colorBtn);
    menu.appendChild(deleteBtn);
    document.body.appendChild(menu);

    const closeMenuHandler = (clickEvent) => {
        if (menu.contains(clickEvent.target) || colorGrid.contains(clickEvent.target) || fontSizeSubmenu.contains(clickEvent.target)) {
            return;
        }
        if (menuOpen) {
            menu.remove();
            document.removeEventListener("click", closeMenuHandler);
        }
    };

    setTimeout(() => {
        document.addEventListener("click", closeMenuHandler);
    }, 0);
}

function applyFontSize(size) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const span = document.createElement("span");
        span.style.fontSize = size + "px";
        const contents = range.extractContents();
        span.appendChild(contents);
        range.insertNode(span);
    }
}

function applyFontColor(color) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const span = document.createElement("span");
        span.style.color = color;
        const contents = range.extractContents();
        span.appendChild(contents);
        range.insertNode(span);
    }
}

function makeDraggable(element, blockId) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    element.addEventListener("mousedown", dragMouseDown, true);

    function dragMouseDown(e) {
        if (isResizing || e.target.classList.contains("resize-handle")) {
            return;
        }

        if (e.target.classList.contains("list-checkbox")) {
            return;
        }

        if (element.classList.contains("text-box")) {
            const rect = element.getBoundingClientRect();
            const margin = 5;
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const isNearEdge = 
                x < margin || x > rect.width - margin ||
                y < margin || y > rect.height - margin;

            if (!isNearEdge) {
                return;
            }
        }

        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        isDragging = true;
        element.classList.add("dragging");

        document.addEventListener("mousemove", elementDragMove, true);
        document.addEventListener("mouseup", elementDragEnd, true);
    }

    function elementDragMove(e) {
        if (!isDragging) return;

        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        const container = element.parentElement;
        const newTop = element.offsetTop - pos2;
        const newLeft = element.offsetLeft - pos1;

        const maxLeft = Math.max(0, container.offsetWidth - element.offsetWidth);
        const maxTop = Math.max(0, container.offsetHeight - element.offsetHeight);

        element.style.top = Math.max(0, Math.min(newTop, maxTop)) + "px";
        element.style.left = Math.max(0, Math.min(newLeft, maxLeft)) + "px";
        
        if (element.resizeHandles) {
            const block = element.closest('.block');
            const rect = element.getBoundingClientRect();
            const blockRect = block.getBoundingClientRect();
            
            element.resizeHandles.tl.style.top = (rect.top - blockRect.top - 6) + 'px';
            element.resizeHandles.tl.style.left = (rect.left - blockRect.left - 6) + 'px';
            element.resizeHandles.tr.style.top = (rect.top - blockRect.top - 6) + 'px';
            element.resizeHandles.tr.style.right = (blockRect.right - rect.right - 6) + 'px';
            element.resizeHandles.br.style.bottom = (blockRect.bottom - rect.bottom - 6) + 'px';
            element.resizeHandles.br.style.right = (blockRect.right - rect.right - 6) + 'px';
            element.resizeHandles.bl.style.bottom = (blockRect.bottom - rect.bottom - 6) + 'px';
            element.resizeHandles.bl.style.left = (rect.left - blockRect.left - 6) + 'px';
            element.resizeHandles.t.style.top = (rect.top - blockRect.top - 6) + 'px';
            element.resizeHandles.t.style.left = (rect.left - blockRect.left + rect.width / 2 - 3) + 'px';
            element.resizeHandles.b.style.bottom = (blockRect.bottom - rect.bottom - 6) + 'px';
            element.resizeHandles.b.style.left = (rect.left - blockRect.left + rect.width / 2 - 3) + 'px';
            element.resizeHandles.l.style.left = (rect.left - blockRect.left - 6) + 'px';
            element.resizeHandles.l.style.top = (rect.top - blockRect.top + rect.height / 2 - 3) + 'px';
            element.resizeHandles.r.style.right = (blockRect.right - rect.right - 6) + 'px';
            element.resizeHandles.r.style.top = (rect.top - blockRect.top + rect.height / 2 - 3) + 'px';
        }
    }

    function elementDragEnd(e) {
        isDragging = false;
        element.classList.remove("dragging");
        document.removeEventListener("mousemove", elementDragMove, true);
        document.removeEventListener("mouseup", elementDragEnd, true);
        saveBlock(blockId);
        saveDataToStorage();
    }
}

function saveBlock(id) {
    const block = document.querySelector(`.block[data-id="${id}"]`);
    const textContainer = block.querySelector(".text-container");
    const textBoxes = textContainer.querySelectorAll(".text-box");
    const listContainers = textContainer.querySelectorAll(".list-container");

    const scaleFactor = getScaleFactor();

    // Filter empty boxes
    const boxData = Array.from(textBoxes)
        .filter(box => box.textContent.trim() !== "")
        .map(box => ({
            type: "text",
            text: box.innerHTML,
            x: parseFloat(box.style.left) * scaleFactor,
            y: parseFloat(box.style.top) * scaleFactor,
            width: parseFloat(box.style.width) * scaleFactor,
            height: parseFloat(box.style.height) * scaleFactor,
            fontSize: box.style.fontSize,
            color: box.style.color
        }));

    // Filter empty lists
    const listData = Array.from(listContainers)
        .filter(container => {
            const items = Array.from(container.querySelectorAll(".list-item"));
            return items.some(item => item.querySelector(".list-label").textContent.trim() !== "");
        })
        .map(container => ({
            type: "list",
            items: Array.from(container.querySelectorAll(".list-item"))
                .filter(item => item.querySelector(".list-label").textContent.trim() !== "")
                .map(item => ({
                    text: item.querySelector(".list-label").textContent,
                    checked: item.querySelector(".list-checkbox").checked
                })),
            x: parseFloat(container.style.left) * scaleFactor,
            y: parseFloat(container.style.top) * scaleFactor,
            width: parseFloat(container.style.width) * scaleFactor,
            height: parseFloat(container.style.height) * scaleFactor,
            fontSize: container.querySelector(".list-label").style.fontSize,
            color: container.querySelector(".list-label").style.color
        }));

    const cleanedData = [...boxData, ...listData];
    
    // Only update if there's actual data
    if (cleanedData.length > 0) {
        undoStack[id] = [cleanedData];
        redoStack[id] = [];
    }

    window.api.updateBlock({
        id: id,
        data: cleanedData
    });
}

function redrawBlock(id) {
    const block = document.querySelector(`.block[data-id="${id}"]`);
    const textContainer = block.querySelector(".text-container");
    
    // Remove old handles
    block.querySelectorAll(".resize-handle").forEach(h => h.remove());
    textContainer.innerHTML = "";

    if (undoStack[id].length === 0) return;

    const inverseScaleFactor = getInverseScaleFactor();
    const allData = undoStack[id][0];

    allData.forEach(item => {
        if (item.type === "text") {
            const textBox = document.createElement("div");
            textBox.className = "text-box";
            textBox.innerHTML = item.text;
            textBox.style.left = (item.x * inverseScaleFactor) + "px";
            textBox.style.top = (item.y * inverseScaleFactor) + "px";
            textBox.style.width = (item.width * inverseScaleFactor) + "px";
            textBox.style.height = (item.height * inverseScaleFactor) + "px";
            textBox.style.fontSize = item.fontSize;
            textBox.style.color = item.color;

            // Skip empty text boxes
            if (textBox.textContent.trim() === "") {
                return;
            }

            if (mode === "editor") {
                createResizeHandles(textBox, block, id);
                makeInteractive(textBox, id);

                textBox.addEventListener("blur", () => {
                    textBox.contentEditable = false;
                    textBox.classList.remove("editing");
                    if (textBox.textContent.trim() === "") {
                        if (textBox.resizeHandles) {
                            Object.values(textBox.resizeHandles).forEach(handle => handle.remove());
                        }
                        textBox.remove();
                        saveDataToStorage();
                    } else {
                        saveBlock(id);
                        saveDataToStorage();
                    }
                });
            } else {
                textBox.style.border = "none";
            }

            textContainer.appendChild(textBox);
        } else if (item.type === "list") {
            const listContainer = document.createElement("div");
            listContainer.className = "list-container";
            listContainer.style.left = (item.x * inverseScaleFactor) + "px";
            listContainer.style.top = (item.y * inverseScaleFactor) + "px";
            listContainer.style.width = (item.width * inverseScaleFactor) + "px";
            listContainer.style.height = (item.height * inverseScaleFactor) + "px";

            item.items.forEach(listItem => {
                const itemDiv = document.createElement("div");
                itemDiv.className = "list-item";

                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.className = "list-checkbox";
                checkbox.checked = listItem.checked;
                checkbox.addEventListener("change", () => {
                    saveBlock(id);
                    saveDataToStorage();
                });

                const label = document.createElement("span");
                label.className = "list-label";
                label.textContent = listItem.text;
                label.style.fontSize = item.fontSize;
                label.style.color = item.color;

                if (mode === "editor") {
                    label.addEventListener("blur", () => {
                        label.contentEditable = false;
                        saveBlock(id);
                        saveDataToStorage();
                    });
                }

                itemDiv.appendChild(checkbox);
                itemDiv.appendChild(label);
                listContainer.appendChild(itemDiv);
            });

            if (mode === "editor") {
                createResizeHandles(listContainer, block, id);
                makeInteractive(listContainer, id);
            } else {
                listContainer.style.border = "none";
            }

            textContainer.appendChild(listContainer);
        }
    });
}

// Load saved data on page load
window.addEventListener("load", () => {
    const drInitialsInputs = document.querySelectorAll(".dr-initials");
    drInitialsInputs.forEach(input => {
        input.addEventListener("input", saveDrInitials);
        input.addEventListener("change", saveDrInitials);
    });

    document.querySelectorAll(".euth-check").forEach(cb => {
        cb.addEventListener("change", saveEuthChecklist);
    });
    
    const savedData = loadSavedData();
    if (savedData) {
        blocks.forEach(block => {
            const id = block.dataset.id;
            if (savedData[id]) {
                undoStack[id] = [savedData[id]];
                redrawBlock(id);
            }
        });
    }
    loadDrInitials();
    initDrBoxMode();
    loadEuthChecklist();
});

window.api.onUpdateBlock((data) => {
    const { id, data: allData } = data;
    if (Array.isArray(allData)) {
        undoStack[id] = allData.length > 0 ? [allData] : [];
        redrawBlock(id);
    }
    saveDataToStorage();
});

if (window.api.onDrInitialsChanged) {
    window.api.onDrInitialsChanged((data) => {
        // Apply received Dr. initials data and update the DOM
        const drInitialsInputs = document.querySelectorAll(".dr-initials");
        drInitialsInputs.forEach(input => {
            const id = input.dataset.id || input.id;
            if (data[id] !== undefined) {
                input.value = data[id];
                if (mode === "board") {
                    const span = input.parentElement.querySelector(".dr-initials-display");
                    if (span) span.textContent = data[id];
                }
            }
        });
        localStorage.setItem(DR_STORAGE_KEY, JSON.stringify(data));
    });
}

if (window.api.onEuthChecklistChanged) {
    window.api.onEuthChecklistChanged((data) => {
        document.querySelectorAll(".euth-check").forEach(cb => {
            if (data[cb.id] !== undefined) {
                cb.checked = data[cb.id];
            }
        });
        localStorage.setItem(EUTH_STORAGE_KEY, JSON.stringify(data));
    });
}

if (mode === "editor") {
    document.addEventListener("keydown", (e) => {
        if (!currentBlock) return;

        if (e.ctrlKey && e.key === "z") {
            undo(currentBlock);
        }

        if (e.ctrlKey && e.key === "y") {
            redo(currentBlock);
        }
    });
}

function undo(id) {
    if (undoStack[id].length === 0) return;
    const last = undoStack[id].pop();
    redoStack[id].push(last);
    redrawBlock(id);
    window.api.updateBlock({
        id: id,
        data: undoStack[id][0] || []
    });
    saveDataToStorage();
}

function redo(id) {
    if (redoStack[id].length === 0) return;
    const last = redoStack[id].pop();
    undoStack[id].push(last);
    redrawBlock(id);
    window.api.updateBlock({
        id: id,
        data: undoStack[id][undoStack[id].length - 1]
    });
    saveDataToStorage();
}

// Deselect when clicking outside boxes
document.addEventListener("click", (e) => {
    // Don't deselect if clicking on a box or handle
    if (e.target.closest(".text-box") || e.target.closest(".list-container") || e.target.classList.contains("resize-handle")) {
        return;
    }
    
    deselectAll();
});

window.setTool = function(selectedTool) {
    tool = selectedTool;
};

window.setFontSize = function(size) {
    currentFontSize = parseInt(size);
};

window.setFontColor = function(color) {
    currentFontColor = color;
};

window.clearBlock = function() {
    if (!currentBlock) return;

    undoStack[currentBlock] = [[]];
    redoStack[currentBlock] = [];

    redrawBlock(currentBlock);
    window.api.updateBlock({
        id: currentBlock,
        data: []
    });
    saveDataToStorage();
};

const dateElement = document.getElementById("currentDate");

if (dateElement) {
    const today = new Date();

    const formattedDate = today.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
    });

    dateElement.textContent = formattedDate;
}