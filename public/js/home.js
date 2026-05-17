const createRoomButton = document.getElementById('createRoom');

createRoomButton.addEventListener('click', () => {

    const roomId = 'mesa-' + Math.floor(Math.random() * 10000);

    window.location.href = `/sala.html?room=${roomId}`;

});