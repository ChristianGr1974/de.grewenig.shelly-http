module.exports = async (socket) => {
  socket.on("save_device", ({ ip }) => {
    socket.emit("success", {
      name: `Shelly Gen2 (${ip})`,
      data: { ip },
      settings: { ip }
    });
  });
};
