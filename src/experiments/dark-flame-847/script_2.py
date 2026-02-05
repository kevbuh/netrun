import gymnasium as gym

# ── Classic Control (works out of the box with just gymnasium) ──
env = gym.make("CartPole-v1")
print("Observation Space:", env.observation_space)
print("Action Space:", env.action_space)

obs, info = env.reset(seed=42)
total_reward = 0
episodes = 0

for _ in range(10_000):
    action = env.action_space.sample()
    obs, reward, terminated, truncated, info = env.step(action)
    total_reward += reward

    if terminated or truncated:
        episodes += 1
        print(f"Episode {episodes} finished with reward: {total_reward}")
        obs, info = env.reset()
        total_reward = 0

env.close()

# ── Atari (requires extra setup) ──
# pip install ale-py AutoROM
# python -m AutoROM --accept-license
#
# import ale_py
# gym.register_envs(ale_py)
# env = gym.make("ALE/MsPacman-v5", frameskip=4)
