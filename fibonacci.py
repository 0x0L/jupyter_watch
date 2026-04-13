def fibonacci(n):
    """Calcule les n premiers nombres de Fibonacci."""
    if n <= 0:
        return []
    if n == 1:
        return [0]
    fib = [0, 1]
    for _ in range(2, n):
        fib.append(fib[-1] + fib[-2])
    return fib


if __name__ == "__main__":
    n = 10
    result = fibonacci(n)
    print(f"Les {n} premiers nombres de Fibonacci :")
    for i, val in enumerate(result):
        print(f"  F({i}) = {val}")
