let currentBlock = null;

function selectBlock(id) {
    currentBlock = id;

    document.getElementById('selector').style.display = "none";
    const area = document.getElementById('editorArea');
    area.style.display = "block";
    area.innerHTML = "";
    area.focus();
}

function save() {
    const content = document.getElementById('editorArea').innerHTML;

    window.api.updateBlock({
        id: currentBlock,
        content: content
    });

    location.reload(); // go back to selector view
}